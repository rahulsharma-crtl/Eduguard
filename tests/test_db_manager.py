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


def test_empty_telemetry_defaults_to_100_percent(temp_db):
    """
    VERIFIED DEFECT:
    In db_manager.py lines 200-201:
    if stats["ceis"]: avg_cei = sum(stats["ceis"]) / len(stats["ceis"])
    else: avg_cei = 1.0
    A student with 0 recorded telemetry receives a 100% avg_cei_pct grade.
    """
    session_id = temp_db.create_session("room_ghost", "GhostStudent", time.time())
    assert session_id is not None
    # No telemetry batch inserted

    ledger = temp_db.get_room_session_summary_ledger("room_ghost")
    assert len(ledger) == 1
    assert ledger[0]["student_name"] == "GhostStudent"
    assert ledger[0]["avg_cei_pct"] == 100.0, "Expected empty session to falsely default to 100.0%"
    assert ledger[0]["primary_state"] == "Mainly Attentive"


def test_mic_muted_falsely_triggers_audio_evasion(temp_db):
    """
    VERIFIED DEFECT:
    In db_manager.py line 209:
    evasion_count = sum(1 for s in statuses if ("audio evasion" in s.lower() or "muted" in s.lower()))
    If a student mutes their mic (status = 'Mic Muted'), evasion_pct >= 0.15 is triggered,
    branding the student with 'Audio Evasion (Silenced Lecture)'.
    """
    session_id = temp_db.create_session("room_audio", "PoliteStudent", time.time())
    records = [
        {"timestamp": time.time(), "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Mic Muted"},
        {"timestamp": time.time() + 1, "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Mic Muted"},
        {"timestamp": time.time() + 2, "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Attentive"},
    ]
    temp_db.insert_telemetry_batch(session_id, records)

    ledger = temp_db.get_room_session_summary_ledger("room_audio")
    assert len(ledger) == 1
    # PoliteStudent who muted mic is falsely flagged as Audio Evasion
    assert ledger[0]["primary_state"] == "Audio Evasion (Silenced Lecture)"


def test_missing_sqlite_indices(temp_db):
    """
    VERIFIED DEFECT / SUSPECTED SCALABILITY RISK:
    Verifies that SQLite table definitions lack indices on foreign key and query filters
    (telemetry.session_id and sessions.room_id).
    """
    with temp_db._get_connection() as conn:
        cursor = conn.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        custom_indices = cursor.fetchall()
        # Only internal sqlite autoindexes for primary keys exist; no explicit performance indexes
        assert len(custom_indices) == 0, f"Found unexpected custom indices: {custom_indices}"
