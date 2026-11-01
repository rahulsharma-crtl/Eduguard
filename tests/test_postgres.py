"""Opt-in real PostgreSQL verification; uses an isolated, disposable schema only."""
import os
import time
import uuid
import pytest
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import make_url
from backend.store import Store
from backend.app import Sample


def test_postgres_migrations_restart_idempotency_and_deletion():
    url = os.getenv('TEST_POSTGRES_URL')
    if not url:
        pytest.skip('TEST_POSTGRES_URL not configured; PostgreSQL persistence is unverified locally')
    parsed = make_url(url)
    if parsed.get_backend_name() not in {'postgresql', 'postgres'}:
        pytest.fail('TEST_POSTGRES_URL must reference a disposable PostgreSQL test database')
    parsed = parsed.set(drivername='postgresql+psycopg')
    admin = create_engine(parsed)
    schema = 'eduguard_test_' + uuid.uuid4().hex
    store = None
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = parsed.update_query_dict({'options': '-csearch_path=' + schema})
    try:
        store = Store(scoped.render_as_string(hide_password=False))
        with store.engine.begin() as conn:
            conn.execute(store.rooms.insert().values(id='test-room', name='Test', closed=False, created_at=time.time()))
        participant = str(uuid.uuid4())
        sid = store.admit('test-room', participant, 'Alias', 'telemetry-only')
        assert store.admit('test-room', participant, 'Alias', 'telemetry-only') == sid
        event = Sample(sample_id=uuid.uuid4(), timestamp=time.time(), cei_score=0, attentiveness=0, distraction=1)
        store.insert_samples('test-room', sid, [event])
        store.insert_samples('test-room', sid, [event])
        assert store.roster('test-room')[0]['total_samples'] == 1
        store.engine.dispose()
        store = Store(scoped.render_as_string(hide_password=False))
        store.migrate()
        assert store.roster('test-room')[0]['avg_cei'] == 0
        assert inspect(store.engine).get_indexes('classroom_samples')
        assert store.heartbeat('test-room', sid)
        store.finish('test-room')
        assert store.roster('test-room')[0]['status'] == 'completed'
        assert not store.heartbeat('test-room', sid)
        with store.engine.begin() as conn:
            conn.execute(store.samples.delete())
            conn.execute(store.intervals.delete())
            conn.execute(store.admissions.delete())
            conn.execute(store.sessions.delete())
            conn.execute(store.rooms.delete())
        assert store.room('test-room') is None
    finally:
        if store:
            store.engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
