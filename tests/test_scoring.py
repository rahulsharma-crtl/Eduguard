import pytest
from config import CONFIG


def calculate_raw_cei(presence: float, attentiveness: float, distraction: float) -> float:
    """Formula as implemented in student_room/frontend/index.html line 719:
    const rawCEI = (0.30 * presence) + (0.45 * attentiveness) - (0.25 * distraction);
    let ceiScore = Math.max(0.0, Math.min(1.0, rawCEI));
    """
    attentiveness = max(0.0, min(1.0, attentiveness))
    distraction = max(0.0, min(1.0, distraction))
    raw_cei = (0.30 * presence) + (0.45 * attentiveness) - (0.25 * distraction)
    return max(0.0, min(1.0, raw_cei))


def test_max_attainable_cei_score_defect():
    """
    VERIFIED DEFECT:
    Even with full presence (1.0), perfect attentiveness (1.0), and zero distraction (0.0),
    the formula produces 0.75 (75%), NEVER 1.0 (100%).
    This causes students with 100% focus to receive an artificial 25% ceiling penalty.
    """
    score = calculate_raw_cei(presence=1.0, attentiveness=1.0, distraction=0.0)
    # The expected mathematical ceiling under the current formula is 0.75, not 1.0.
    assert score == pytest.approx(0.75, abs=1e-4), f"Expected 0.75 max score, got {score}"
    assert score < 1.0, "Score unexpectedly reached 1.0 despite formula deficit"


def test_config_weights_sum_to_one():
    """
    Verifies the relationship in config.py weights:
    WEIGHT_PRESENCE: 0.30
    WEIGHT_ATTENTIVENESS: 0.45
    WEIGHT_DISTRACTION: 0.25
    The sum is 1.0, but distraction is subtracted instead of inverted (1 - distraction),
    which is why the max score is 0.75 instead of 1.00.
    """
    total = CONFIG.WEIGHT_PRESENCE + CONFIG.WEIGHT_ATTENTIVENESS + CONFIG.WEIGHT_DISTRACTION
    assert total == pytest.approx(1.0, abs=1e-4)

    # If distraction was properly inverted as (1 - D):
    corrected_score = (
        CONFIG.WEIGHT_PRESENCE * 1.0
        + CONFIG.WEIGHT_ATTENTIVENESS * 1.0
        + CONFIG.WEIGHT_DISTRACTION * (1.0 - 0.0)
    )
    assert corrected_score == pytest.approx(1.0, abs=1e-4)


def calculate_normalized_cei(
    presence: float, attentiveness: float, distraction: float
) -> float:
    """Normalized CEI formulation: clamp(wP*P + wA*A + wD*(1-D), 0, 1)."""
    if presence <= 0.0:
        return 0.0
    p = max(0.0, min(1.0, presence))
    a = max(0.0, min(1.0, attentiveness))
    d = max(0.0, min(1.0, distraction))
    raw = (
        CONFIG.WEIGHT_PRESENCE * p
        + CONFIG.WEIGHT_ATTENTIVENESS * a
        + CONFIG.WEIGHT_DISTRACTION * (1.0 - d)
    )
    return max(0.0, min(1.0, raw))


def test_normalized_cei_ideal_attention():
    """Verify ideal attention reaches 1.0 (100%) under normalized formula."""
    score = calculate_normalized_cei(
        presence=1.0, attentiveness=1.0, distraction=0.0
    )
    assert score == pytest.approx(1.0, abs=1e-4)


def test_normalized_cei_absence_forced_to_zero():
    """Verify absence is explicitly forced to 0.0, not 0.25 from (1 - D)."""
    score = calculate_normalized_cei(
        presence=0.0, attentiveness=1.0, distraction=0.0
    )
    assert score == 0.0


def test_normalized_cei_bounds_clamping():
    """Verify CEI is clamped to [0.0, 1.0] under extreme values."""
    assert calculate_normalized_cei(5.0, 10.0, -2.0) == 1.0
    assert calculate_normalized_cei(-1.0, -5.0, 10.0) == 0.0
    assert calculate_normalized_cei(1.0, 0.0, 1.0) == pytest.approx(0.30)
