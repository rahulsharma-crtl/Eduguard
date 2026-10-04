from dataclasses import dataclass

@dataclass(frozen=True)
class SystemConfig:
    FRAME_WIDTH: int = 640
    FRAME_HEIGHT: int = 480
    TARGET_FPS: int = 30
    TEMPORAL_WINDOW_SIZE: int = 30

    # Behavioral Kinematics & Scoring Thresholds
    EAR_THRESHOLD: float = 0.21
    EAR_CONSEC_FRAMES: int = 2
    DROWSINESS_FRAME_LIMIT: int = 15

    WEIGHT_PRESENCE: float = 0.30
    WEIGHT_ATTENTIVENESS: float = 0.45
    WEIGHT_DISTRACTION: float = 0.25

    # Aesthetics
    THEME_PRIMARY_COLOR: str = "#4E6BFF"
    THEME_BG_COLOR: str = "#0E1117"
    THEME_TEXT_COLOR: str = "#FAFAFA"

CONFIG = SystemConfig()
