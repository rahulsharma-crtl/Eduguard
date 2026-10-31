import os
import time
import gc
import pytest
from core.db_manager import DatabaseManager


@pytest.fixture
def temp_db(tmp_path):
    db_file = str(tmp_path / "test_telemetry.db")
    db = DatabaseManager(db_path=db_file)
    yield db
    gc.collect()



def test_session_lifecycle_and_telemetry(temp_db):
    session_id = temp_db.create_session("room_101", "Alice", time.time())
    assert session_id is not None

    records = [
        {"timestamp": time.time(), "cei": 0.8, "attentiveness": 0.9, "distraction": 0.1, "status": "Attentive"},
        {"timestamp": time.time() + 1, "cei": 0.75, "attentiveness": 0.8, "distraction": 0.2, "status": "Attentive"},
    ]
    temp_db.insert_telemetry_batch(session_id, records)

    telemetry = temp_db.get_telemetry(session_id)
    assert len(telemetry) == 2
    assert telemetry[0]["cei"] == 0.8


def test_empty_telemetry_is_not_scored_as_attentive(temp_db):
    """An empty session is explicitly unscored rather than assigned perfect engagement."""
    session_id = temp_db.create_session("room_ghost", "GhostStudent", time.time())
    assert session_id is not None
    # A caller-supplied perfect average must not replace missing observations.
    temp_db.end_session(session_id,time.time(),1.0)
    assert temp_db.get_all_sessions('room_ghost')[0]['avg_cei'] is None

    ledger = temp_db.get_room_session_summary_ledger("room_ghost")
    assert len(ledger) == 1
    assert ledger[0]["student_name"] == "GhostStudent"
    assert ledger[0]["avg_cei_pct"] is None
    assert ledger[0]["primary_state"] == "No Telemetry Recorded"


def test_mic_muted_does_not_trigger_audio_evasion(temp_db):
    """Normal microphone muting must not trigger lecture-audio evasion."""
    session_id = temp_db.create_session("room_audio", "PoliteStudent", time.time())
    records = [
        {"timestamp": time.time(), "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Mic Muted"},
        {"timestamp": time.time() + 1, "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Mic Muted"},
        {"timestamp": time.time() + 2, "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Attentive"},
    ]
    temp_db.insert_telemetry_batch(session_id, records)

    ledger = temp_db.get_room_session_summary_ledger("room_audio")
    assert len(ledger) == 1
    assert ledger[0]["primary_state"] == "Moderate Attention"


def test_sqlite_query_indices(temp_db):
    """Both classroom lookup and session telemetry queries have explicit indexes."""
    with temp_db._get_connection() as conn:
        cursor = conn.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        custom_indices = cursor.fetchall()
        assert {row[0] for row in custom_indices} >= {"idx_sessions_room_id", "idx_telemetry_session_id"}


def test_connection_is_closed(temp_db):
    import sqlite3
    with temp_db._get_connection() as conn:
        conn.execute("SELECT 1")
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")


def test_abandoned_session_recovered_from_persisted_samples(temp_db):
    start = time.time() - 120
    session = temp_db.create_session("recovery", "Alice", start)
    temp_db.insert_telemetry_batch(session, [
        {"timestamp": start + 1, "cei": 0.5, "attentiveness": 0.5, "distraction": 0, "status": "Attentive"},
        {"timestamp": start + 2, "cei": 1, "attentiveness": 1, "distraction": 0, "status": "Attentive"}])
    with temp_db._get_connection() as conn:
        conn.execute("UPDATE sessions SET last_seen=? WHERE session_id=?",(start+2,session))
        conn.execute("UPDATE legacy_attendance_intervals SET started_at=?,last_seen=? WHERE session_id=?",(start,start+2,session))
    temp_db.close_stale_sessions()
    record = temp_db.get_all_sessions("recovery")[0]
    assert record["end_time"] == start + 2
    assert record["avg_cei"] == 0.75


def test_live_session_not_closed(temp_db):
    session = temp_db.create_session("live", "Alice", time.time())
    temp_db.close_stale_sessions()
    assert temp_db.get_all_sessions("live")[0]["end_time"] is None


def test_connection_rolls_back_on_exception(temp_db):
    with pytest.raises(RuntimeError):
        with temp_db._get_connection() as conn:
            conn.execute("INSERT INTO sessions(room_id,student_name,start_time) VALUES ('rollback','Alice',0)")
            raise RuntimeError("transaction failure")
    assert temp_db.get_all_sessions("rollback") == []


def test_unknown_observation_heartbeat_keeps_session_open(temp_db):
    session = temp_db.create_session("unknown", "Alice", time.time() - 120)
    temp_db.touch_session(session)
    temp_db.close_stale_sessions()
    assert temp_db.get_all_sessions("unknown")[0]["end_time"] is None


def test_retried_sample_is_idempotent(temp_db):
    session = temp_db.create_session("retry", "Alice", time.time())
    record = {"sample_id": "same-sample", "timestamp": time.time(), "cei": 1,
              "attentiveness": 1, "distraction": 0, "status": "Attentive"}
    temp_db.insert_telemetry_batch(session, [record])
    temp_db.insert_telemetry_batch(session, [record, record])
    assert len(temp_db.get_telemetry(session)) == 1


def test_legacy_stable_participant_names_and_room_finalization(temp_db):
    one=temp_db.create_session('room','Same Name',time.time(),participant_id='id-1')
    assert temp_db.create_session('room','Same Name',time.time(),participant_id='id-1')==one
    two=temp_db.create_session('room','Same Name',time.time(),participant_id='id-2')
    assert one!=two
    assert len(temp_db.get_room_session_summary_ledger('room'))==2
    temp_db.finalize_room('room')
    with pytest.raises(ValueError):
        temp_db.insert_telemetry_batch(one,[{'timestamp':time.time(),'cei':1,'attentiveness':1,'distraction':0,'status':'Attentive'}])
    temp_db.touch_session(one)
    assert all(row['end_time'] is not None for row in temp_db.get_all_sessions('room'))


def test_legacy_migration_preserves_historical_rows_and_missing_scores(tmp_path):
    import sqlite3
    path=tmp_path/'historical.db'
    with sqlite3.connect(path) as conn:
        conn.executescript("""
        CREATE TABLE sessions(session_id INTEGER PRIMARY KEY,room_id TEXT,student_name TEXT,start_time REAL,end_time REAL,avg_cei REAL);
        CREATE TABLE telemetry(id INTEGER PRIMARY KEY,session_id INTEGER,timestamp REAL,cei REAL,attentiveness REAL,distraction REAL,status TEXT);
        INSERT INTO sessions VALUES(1,'history','Same Name',1000,1100,0.62);
        INSERT INTO sessions VALUES(2,'history','Same Name',1200,1300,1.0);
        INSERT INTO telemetry VALUES(1,1,1050,0.62,0.5,0.2,'Observed');
        """)
    db=DatabaseManager(str(path))
    with db._get_connection() as conn:
        assert conn.execute('SELECT session_id,start_time,end_time,avg_cei FROM sessions ORDER BY session_id').fetchall()==[(1,1000,1100,.62),(2,1200,1300,1)]
        assert conn.execute('SELECT timestamp,cei FROM telemetry').fetchall()==[(1050,.62)]
    rows=db.get_room_session_summary_ledger('history')
    assert len(rows)==2
    assert sorted(row['avg_cei_pct'] for row in rows if row['avg_cei_pct'] is not None)==[62]
    assert sum(row['avg_cei_pct'] is None for row in rows)==1
    assert all(row['duration_seconds']==0 and not row['attendance_verified'] for row in rows)
    DatabaseManager(str(path))
    assert len(db.get_all_sessions('history'))==2
