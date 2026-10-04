"""
EduGuard Configuration Module
=============================
Purpose: Centralizes hyperparameters, thresholds, and configuration settings.
"""

from dataclasses import dataclass
import os

@dataclass(frozen=True)
class SystemConfig:
    # Camera Optimization Settings
    CAMERA_INDEX: int = 0
    FRAME_WIDTH: int = 640
    FRAME_HEIGHT: int = 480
    TARGET_FPS: int = 30
    
    # Frame skipping ratios
    SPATIAL_FRAME_SKIP: int = 1   
    OBJECT_FRAME_SKIP: int = 5   

    # Temporal Window Settings
    TEMPORAL_WINDOW_SIZE: int = 30  
    
    # Thresholds
    EAR_THRESHOLD: float = 0.21      
    EAR_CONSEC_FRAMES: int = 2       
    DROWSINESS_FRAME_LIMIT: int = 15 
    
    # Object Detection Settings
    MODEL_DIR: str = os.path.join(os.path.dirname(__file__), "models")
    YOLO_WEIGHTS_NAME: str = "yolov8n.pt"
    YOLO_WEIGHTS_PATH: str = os.path.join(MODEL_DIR, YOLO_WEIGHTS_NAME)
    YOLO_CONFIDENCE_THRESH: float = 0.25
    TARGET_CLASSES: tuple = (0, 67, 73)

    # CEI Weights: E = (W1 * P) + (W2 * A) - (W3 * D)
    WEIGHT_PRESENCE: float = 0.30
    WEIGHT_ATTENTIVENESS: float = 0.45
    WEIGHT_DISTRACTION: float = 0.25

    # Aesthetics
    THEME_PRIMARY_COLOR: str = "#4E6BFF"
    THEME_BG_COLOR: str = "#0E1117"
    THEME_TEXT_COLOR: str = "#FAFAFA"

CONFIG = SystemConfig()
os.makedirs(CONFIG.MODEL_DIR, exist_ok=True)
