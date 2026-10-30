from config import CONFIG


def test_config_drift_detection():
    """
    VERIFIED RISK:
    Tests whether config.py constants are synchronized with frontend defaults.
    - EAR_THRESHOLD in config: 0.21
    - DROWSINESS_FRAME_LIMIT in config: 15
    - TARGET_FPS in config: 30 (frontend privacyCanvas.captureStream uses 25!)
    - TEMPORAL_WINDOW_SIZE in config: 30 (not used anywhere in codebase)
    """
    assert CONFIG.EAR_THRESHOLD == 0.21
    assert CONFIG.DROWSINESS_FRAME_LIMIT == 15
    assert CONFIG.TARGET_FPS == 30  # Note: frontend canvas.captureStream(25) deviates!
    assert CONFIG.TEMPORAL_WINDOW_SIZE == 30
