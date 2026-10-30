import time
import gc
import pytest
from core.db_manager import DatabaseManager
from core.reporting import generate_csv_report


@pytest.fixture
def temp_db(tmp_path):
    db_file = str(tmp_path / "test_reporting.db")
    db = DatabaseManager(db_path=db_file)
    yield db
    gc.collect()



def test_generate_csv_report_success(temp_db):
    session_id = temp_db.create_session("room_rep", "Bob", time.time())
    records = [
        {"timestamp": 1700000000.0, "cei": 0.75, "attentiveness": 1.0, "distraction": 0.0, "status": "Attentive"},
    ]
    temp_db.insert_telemetry_batch(session_id, records)

    csv_data = generate_csv_report(temp_db, session_id)
    assert csv_data is not None
    assert "cei_percent" in csv_data
    assert "75.0%" in csv_data
    assert "Attentive" in csv_data


def test_generate_csv_report_empty(temp_db):
    session_id = temp_db.create_session("room_empty", "Charlie", time.time())
    csv_data = generate_csv_report(temp_db, session_id)
    assert csv_data is None
