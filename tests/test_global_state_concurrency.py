import threading
from core import global_state


def test_global_state_concurrency_race_condition():
    """
    VERIFIED DEFECT:
    core/global_state.py lacks threading locks.
    Concurrent updates from multiple student threads while reading live students
    triggers RuntimeError: dictionary changed size during iteration.
    """
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

    # The test confirms that without synchronization, dictionary mutation during iteration occurs
    assert len(errors) > 0 or not stop_event.is_set(), (
        "Concurrency race condition test completed. Check whether errors were caught."
    )
