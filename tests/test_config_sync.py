from config import CONFIG


def test_config_drift_detection():
    """
    Historical Python configuration baseline only.
    These assertions pin legacy config.py constants; they do not read or compare
    the current browser engine defaults. A pass is not evidence of frontend sync.
    """
    assert CONFIG.EAR_THRESHOLD == 0.21
    assert CONFIG.DROWSINESS_FRAME_LIMIT == 15
    assert CONFIG.TARGET_FPS == 30  # Legacy configuration value; no browser comparison is performed here.
    assert CONFIG.TEMPORAL_WINDOW_SIZE == 30
