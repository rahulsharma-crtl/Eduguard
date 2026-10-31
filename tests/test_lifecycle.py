import time
import uuid
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select
from backend.store import Store
from backend.app import Sample


def setup_store(tmp_path):
    store=Store(f"sqlite:///{tmp_path/'lifecycle.db'}")
    with store.engine.begin() as conn:
        conn.execute(store.rooms.insert().values(id='room',name='Room',created_at=time.time(),closed=False))
    return store


def event(timestamp,known=True):
    return Sample(sample_id=uuid.uuid4(),timestamp=timestamp,cei_score=0 if known else None,
                  attentiveness=0 if known else None,distraction=1 if known else None,is_unknown=not known)


def test_crash_recovery_reconnect_and_validated_duration(tmp_path,monkeypatch):
    clock=[1000.0];monkeypatch.setattr('backend.store.time.time',lambda:clock[0])
    store=setup_store(tmp_path);sid=store.admit('room','private-client','Alias','mesh')
    clock[0]=1010;assert store.heartbeat('room',sid)
    store.close_stale(now=1045)
    assert store.roster('room')[0]['status']=='stale'
    store.engine.dispose()
    recovered=Store(f"sqlite:///{tmp_path/'lifecycle.db'}")
    clock[0]=1050
    assert recovered.admit('room','private-client','Alias','mesh')==sid
    clock[0]=1060;assert recovered.heartbeat('room',sid)
    row=recovered.roster('room')[0]
    assert row['duration_seconds']==20
    assert row['disconnected_seconds']==40
    assert row['unobserved_seconds']==20
    assert row['avg_cei'] is None
    assert row['started_at_utc'].endswith('+00:00')
    recovered.finish('room')
    before=recovered.roster('room')[0]['ended_at']
    clock[0]=1070;recovered.finish('room')
    assert recovered.roster('room')[0]['ended_at']==before
    assert not recovered.heartbeat('room',sid)
    assert recovered.admit('room','private-client','Alias','mesh') is None
    recovered.engine.dispose()


def test_duplicate_events_and_missing_vs_low_observations(tmp_path,monkeypatch):
    clock=[1000.0];monkeypatch.setattr('backend.store.time.time',lambda:clock[0])
    store=setup_store(tmp_path);sid=store.admit('room','client','Alias','telemetry-only')
    known=event(1000);unknown=event(1005,False)
    clock[0]=1010;store.heartbeat('room',sid)
    assert store.insert_samples('room',sid,[known,unknown])
    assert store.insert_samples('room',sid,[known,unknown])
    row=store.roster('room')[0]
    assert row['total_samples']==2
    assert row['avg_cei']==0
    assert row['observed_seconds']==5
    assert row['unobserved_seconds']==5
    assert row['duration_seconds']==10
    store.engine.dispose()


def test_concurrent_students_and_idempotent_admission(tmp_path):
    store=setup_store(tmp_path)
    def admit(client):return store.admit('room',client,'Same Name','mesh')
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids=list(pool.map(admit,['retry']*8+[f'client-{i}' for i in range(8)]))
    assert len(set(ids[:8]))==1
    assert len(store.roster('room'))==9
    sid=ids[0];sample=event(time.time())
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(lambda _:store.insert_samples('room',sid,[sample]),range(8)))
    with store.engine.connect() as conn:
        assert len(conn.execute(select(store.samples)).all())==1
    store.engine.dispose()


def test_additive_migration_keeps_old_records_and_does_not_invent_attendance(tmp_path):
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as conn:
        conn.executescript("""
        CREATE TABLE classrooms(id VARCHAR(80) PRIMARY KEY,name VARCHAR(100),closed BOOLEAN,created_at FLOAT);
        CREATE TABLE classroom_sessions(id VARCHAR(36) PRIMARY KEY,room_id VARCHAR(80),client_id VARCHAR(36),name VARCHAR(100),started_at FLOAT,last_seen FLOAT,ended_at FLOAT);
        CREATE TABLE classroom_samples(session_id VARCHAR(36),sample_id VARCHAR(36),timestamp FLOAT,cei FLOAT,attentiveness FLOAT,distraction FLOAT,status VARCHAR(120),is_unknown BOOLEAN,PRIMARY KEY(session_id,sample_id));
        INSERT INTO classrooms VALUES('old','Old',0,1000);
        INSERT INTO classroom_sessions VALUES('session','old','client','Alias',1000,2000,2000);
        INSERT INTO classroom_samples VALUES('session','sample',1500,0.6,0.5,0.2,'Observed',0);
        """)
    store=Store(f'sqlite:///{path}')
    with store.engine.connect() as conn:
        assert conn.execute(select(store.samples.c.timestamp,store.samples.c.cei)).first()==(1500,.6)
        assert conn.execute(select(store.sessions.c.started_at,store.sessions.c.ended_at)).first()==(1000,2000)
    row=store.roster('old')[0]
    assert row['duration_seconds']==0 and row['attendance_verified'] is False
    assert row['historical_span_seconds']==1000
    assert row['avg_cei']==.6
    store.engine.dispose()
    repeat=Store(f'sqlite:///{path}')
    with repeat.engine.connect() as conn:assert len(conn.execute(select(repeat.migrations)).all())==1
    repeat.engine.dispose()
