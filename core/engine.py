"""
Composite Engagement Index (CEI) Engine Module
==============================================
Purpose:
Orchestrates synchronized execution of the Tri-Stream pipeline. Grabs real-time frames,
routes intermediate spatial/object representations, applies temporal smoothing,
and evaluates the definitive mathematical formulation to grade continuous engagement.
"""

import sys
import os
import logging
from typing import Dict, Any, Optional
import cv2
import numpy as np

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG
from core.webcam_manager import WebcamManager
# CRITICAL: ObjectStream (PyTorch) MUST be imported BEFORE PrivacyLayer (MediaPipe) on Windows
from core.object_stream import ObjectStream
from core.privacy_layer import PrivacyLayer
from core.spatial_stream import SpatialStream
from core.temporal_stream import TemporalStream


class CEIEngine:
    """
    Synchronous coordinator module linking sensor ingest streams to unified engagement grading.
    """
    def __init__(self, managed_webcam: Optional[WebcamManager] = None):
        self.webcam = managed_webcam if managed_webcam is not None else WebcamManager()
        self.owns_webcam = managed_webcam is None

        # Instantiate streams in order (ObjectStream loads PyTorch first)
        self.object_stream = ObjectStream()
        self.privacy_layer = PrivacyLayer()
        self.spatial_stream = SpatialStream()
        self.temporal_stream = TemporalStream()

        self.is_running: bool = False
        self.blank_canvas = np.zeros((CONFIG.FRAME_HEIGHT, CONFIG.FRAME_WIDTH, 3), dtype=np.uint8)

    def start(self) -> bool:
        logging.info("Initializing CEI Analytical Engine...")
        if self.owns_webcam and not self.webcam.running:
            if not self.webcam.start():
                logging.error("Failed to allocate physical camera hardware path.")
                return False

        # Ensure object stream model is fully pre-warmed and ready
        self.object_stream.wait_until_ready(timeout=10.0)

        self.is_running = True
        self.temporal_stream.reset()
        return True

    def step(self, custom_frame: Optional[np.ndarray] = None) -> Dict[str, Any]:
        if custom_frame is not None:
            raw_frame = custom_frame
            success = True
        else:
            success, raw_frame = self.webcam.read()

        if not success or raw_frame is None:
            return {
                "cei_score": 0.0,
                "privacy_canvas": self.blank_canvas.copy(),
                "presence": 0.0,
                "attentiveness": 0.0,
                "distraction": 0.0,
                "status_message": "Stream Offline",
                "alerts": ["No Active Input"],
                "spatial_raw": {},
                "object_raw": {}
            }

        height, width, _ = raw_frame.shape

        # Step 1: Extract spatial mesh and generate privacy wireframe
        privacy_canvas, mp_results = self.privacy_layer.process_frame(raw_frame)
        coords = self.privacy_layer.extract_normalized_coords(mp_results, width, height)

        # Step 2: Spatial stream analytics
        spatial_metrics = self.spatial_stream.process_landmarks(coords)
        inst_attentiveness = spatial_metrics["attentiveness_score"]

        # Step 3: Object stream analytics
        object_metrics = self.object_stream.process_frame(raw_frame)
        inst_distraction = object_metrics["distraction_score"]
        inst_presence = 1.0 if object_metrics["person_detected"] else 0.0

        if coords is None:
            inst_presence = 0.0
            inst_attentiveness = 0.0

        # Step 4: Overlay detected object HUD bounding boxes onto privacy canvas
        # Visual cues for distraction while strictly preserving facial/environment privacy
        for det in object_metrics.get("bounding_boxes", []):
            box = det["box"]
            cls_name = det["name"]
            conf = det["conf"]
            x1, y1, x2, y2 = box

            if cls_name == "cell phone":
                color = (40, 40, 255)  # Vivid neon red
                label = f"ALERT: CELL PHONE [{conf*100:.0f}%]"
            elif cls_name == "book":
                color = (0, 180, 255)  # Vivid neon amber
                label = f"BOOK [{conf*100:.0f}%]"
            else:
                color = (255, 120, 200)
                label = f"{cls_name.upper()} [{conf*100:.0f}%]"

            cv2.rectangle(privacy_canvas, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
            cv2.putText(
                privacy_canvas,
                label,
                (x1, max(y1 - 8, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
                cv2.LINE_AA
            )

        # Step 5: Temporal smoothing
        smoothed = self.temporal_stream.smooth(
            attentiveness=inst_attentiveness,
            distraction=inst_distraction,
            presence=inst_presence
        )

        s_presence = smoothed["smoothed_presence"]
        s_attentiveness = smoothed["smoothed_attentiveness"]
        s_distraction = smoothed["smoothed_distraction"]

        # Step 6: CEI Formula: E = (W1 * P) + (W2 * A) - (W3 * D)
        raw_cei = (CONFIG.WEIGHT_PRESENCE * s_presence) + \
                  (CONFIG.WEIGHT_ATTENTIVENESS * s_attentiveness) - \
                  (CONFIG.WEIGHT_DISTRACTION * s_distraction)

        cei_score = max(0.0, min(1.0, float(raw_cei)))

        alerts = []
        if spatial_metrics.get("is_drowsy"):
            alerts.append("Prolonged Eye Closure Detected")
        if spatial_metrics.get("is_looking_away"):
            alerts.append("Subject Gaze Divergent")
        if len(object_metrics.get("detected_objects", [])) > 0:
            alerts.append(f"Workspace Interruption: {', '.join(object_metrics['detected_objects'])}")
        if s_presence < 0.2:
            alerts.append("Sustained Subject Absence")

        status_msg = spatial_metrics["status_message"]
        if not object_metrics["person_detected"]:
            status_msg = object_metrics["status_message"]
        elif len(alerts) > 0:
            status_msg = alerts[0]

        return {
            "cei_score": cei_score,
            "privacy_canvas": privacy_canvas,
            "presence": s_presence,
            "attentiveness": s_attentiveness,
            "distraction": s_distraction,
            "status_message": status_msg,
            "alerts": alerts,
            "spatial_raw": spatial_metrics,
            "object_raw": object_metrics
        }

    def stop(self) -> None:
        logging.info("Halting CEI engine...")
        self.is_running = False
        if self.owns_webcam:
            self.webcam.stop()
        self.privacy_layer.release()
