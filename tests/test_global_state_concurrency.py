import threading
from core import global_state


def test_global_state_concurrency_race_condition():
    """Concurrent room updates and snapshots must finish without iteration errors."""
    state = global_state.get_shared_state()
    state.clear()
    errors = []
    stop_event = threading.Event()

    def writer(tid: int):
        i = 0
        while not stop_event.is_set() and i < 2000:
            global_state.update_student_presence("room_test", f"student_{tid}_{i}", 0.85, "Attentive")
            i += 1

    def reader():
        for _ in range(500):
            if stop_event.is_set():
                break
            try:
                global_state.get_live_students("room_test", timeout_seconds=6)
                global_state.get_total_joined_students("room_test")
            except RuntimeError as e:
                errors.append(str(e))
                stop_event.set()
                break

    writers = [threading.Thread(target=writer, args=(k,)) for k in range(4)]
    readers = [threading.Thread(target=reader) for _ in range(4)]

    for t in writers + readers:
        t.start()
    for t in writers + readers:
        t.join()

    assert errors == [], f"Concurrent reads failed: {errors}"


def test_live_student_snapshot_does_not_mutate_shared_state():
    global_state.update_student_presence("copies", "Alice", 1.0, "Attentive")
    snapshot = global_state.get_live_students("copies")
    snapshot["Alice"]["status"] = "modified"
    assert global_state.get_live_students("copies")["Alice"]["status"] == "Attentive"
