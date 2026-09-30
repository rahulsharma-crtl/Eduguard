"""
Spatial Stream Processing Module
================================
Purpose:
Computes instantaneous attentiveness metrics directly from extracted facial landmark arrays.
Calculates Eye Aspect Ratio (EAR) using the 6-point Soukupová & Čech formulation for both eyes.
Provides temporal debouncing for natural blinks (preventing false alarms) and tracks prolonged drowsiness.
Implements 2D head pose kinematics for horizontal yaw (looking away) and vertical pitch (looking down at lap/desk).
"""

import os
import sys
import logging
from typing import Optional, Dict, Any, Tuple
import numpy as np

# Adjust system path for configuration retrieval
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class SpatialStream:
    """
    Analyzes geometric facial landmark configurations to quantify attentiveness,
    blink debouncing, drowsiness tracking, and 2D head pose kinematics.
    """
    def __init__(self,
                 ear_threshold: float = CONFIG.EAR_THRESHOLD,
                 consec_frames_blink: int = CONFIG.EAR_CONSEC_FRAMES,
                 drowsy_limit: int = CONFIG.DROWSINESS_FRAME_LIMIT):
        self.ear_threshold = ear_threshold
        self.consec_frames_blink = consec_frames_blink  # e.g., 2 frames min for complete blink
        self.drowsy_limit = drowsy_limit                # e.g., >= 15 frames for drowsiness

        # State tracking counters
        self.eye_closed_frames: int = 0
        self.total_blinks: int = 0
        self.is_drowsy: bool = False

        # Exact MediaPipe Face Mesh landmark indices:
        # Right Eye: [33, 160, 158, 133, 153, 144] -> p1..p6
        # Left Eye:  [362, 385, 387, 263, 373, 380] -> p1..p6
        self.RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
        self.LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380]

        # Landmark points for 2D head pose heuristics
        self.NOSE_TIP = 1
        self.LEFT_EYE_CORNER = 263
        self.RIGHT_EYE_CORNER = 33
        self.FOREHEAD = 10
        self.CHIN = 152

    @staticmethod
    def compute_ear(eye_pts: np.ndarray) -> float:
        """
        Computes the standard 6-point Soukupová & Čech Eye Aspect Ratio (EAR):
            EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
            
        Args:
            eye_pts: Array of shape (6, 2) corresponding to [p1, p2, p3, p4, p5, p6].
        """
        p1 = eye_pts[0]
        p2 = eye_pts[1]
        p3 = eye_pts[2]
        p4 = eye_pts[3]
        p5 = eye_pts[4]
        p6 = eye_pts[5]

        # Vertical distances between upper and lower eyelids
        vert1 = np.linalg.norm(p2 - p6)
        vert2 = np.linalg.norm(p3 - p5)

        # Horizontal distance between outer and inner eye corners
        horiz = np.linalg.norm(p1 - p4)

        if horiz < 1e-6:
            return 0.0

        ear = (vert1 + vert2) / (2.0 * horiz)
        return float(ear)

    def check_head_pose(self, coords: np.ndarray) -> Tuple[bool, float, float, str]:
        """
        Computes 2D head pose kinematic heuristics for Yaw and Pitch.
        
        - Yaw: Ratio of distance from nose tip (1) to left eye corner (263) 
               vs nose tip (1) to right eye corner (33).
        - Pitch: Ratio of distance from nose tip (1) to forehead (10) 
                 vs nose tip (1) to chin (152).
                 
        Returns:
            (is_looking_away, yaw_ratio, pitch_ratio, pose_description)
        """
        nose = coords[self.NOSE_TIP]
        left_corner = coords[self.LEFT_EYE_CORNER]
        right_corner = coords[self.RIGHT_EYE_CORNER]
        forehead = coords[self.FOREHEAD]
        chin = coords[self.CHIN]

        # Horizontal distances (Yaw)
        dist_to_left = abs(nose[0] - left_corner[0])
        dist_to_right = abs(nose[0] - right_corner[0])

        yaw_ratio = float(dist_to_left) / float(dist_to_right + 1e-6)

        # Vertical distances (Pitch)
        dist_to_forehead = abs(nose[1] - forehead[1])
        dist_to_chin = abs(chin[1] - nose[1])

        pitch_ratio = float(dist_to_forehead) / float(dist_to_chin + 1e-6)

        # Yaw thresholds: Looking left/right if ratio diverges significantly from ~1.0
        # Normal facing: ~0.6 to 1.8
        is_yaw_averted = yaw_ratio < 0.45 or yaw_ratio > 2.2

        # Pitch thresholds: 
        # Looking down at lap/desk/phone: chin compresses toward nose, pitch_ratio increases (> 1.75)
        # Looking up at ceiling: forehead compresses toward nose, pitch_ratio decreases (< 0.45)
        is_pitch_down = pitch_ratio > 1.75
        is_pitch_up = pitch_ratio < 0.45
        is_pitch_averted = is_pitch_down or is_pitch_up

        is_looking_away = is_yaw_averted or is_pitch_averted

        pose_desc = "Centered"
        if is_pitch_down:
            pose_desc = "Looking Down (Desk/Lap)"
        elif is_pitch_up:
            pose_desc = "Looking Up"
        elif is_yaw_averted:
            pose_desc = "Looking Away"

        return is_looking_away, yaw_ratio, pitch_ratio, pose_desc

    def process_landmarks(self, coords: Optional[np.ndarray]) -> Dict[str, Any]:
        """
        Processes normalized/scaled facial landmarks for attentiveness scoring.
        Incorporates temporal blink debouncing and 2D head pose kinematic checks.

        Returns:
            Dict containing ear, total_blinks, attentiveness_score, is_drowsy, 
            is_looking_away, yaw_ratio, pitch_ratio, status_message.
        """
        # Baseline fallback for absent face
        if coords is None or len(coords) < 468:
            self.eye_closed_frames = 0
            self.is_drowsy = False
            return {
                "ear": 0.0,
                "total_blinks": self.total_blinks,
                "attentiveness_score": 0.0,
                "is_drowsy": False,
                "is_looking_away": True,
                "yaw_ratio": 1.0,
                "pitch_ratio": 1.0,
                "status_message": "Subject Absent"
            }

        # 1. Compute 6-point EAR for both eyes
        right_eye_pts = coords[self.RIGHT_EYE_INDICES]
        left_eye_pts = coords[self.LEFT_EYE_INDICES]

        ear_right = self.compute_ear(right_eye_pts)
        ear_left = self.compute_ear(left_eye_pts)
        avg_ear = (ear_right + ear_left) / 2.0

        # 2. Temporal Debouncing for Blinking vs. Drowsiness
        # Natural blinks last 2-4 frames (~100-150ms at 30 FPS).
        # We must NOT trigger alerts or penalize attentiveness score during natural blinks.
        # Prolonged eye closure must persist for >= drowsy_limit (15 frames) to trigger alert.
        if avg_ear < self.ear_threshold:
            self.eye_closed_frames += 1
            if self.eye_closed_frames >= self.drowsy_limit:
                self.is_drowsy = True
        else:
            # Eyes re-opened: Check if this was a valid natural blink
            if self.consec_frames_blink <= self.eye_closed_frames < self.drowsy_limit:
                self.total_blinks += 1
            self.eye_closed_frames = 0
            self.is_drowsy = False

        # 3. 2D Head Pose Kinematics
        is_looking_away, yaw_ratio, pitch_ratio, pose_desc = self.check_head_pose(coords)

        # 4. Synthesize Instantaneous Attentiveness Score
        # Debouncing rule: Natural transient blinks (< 15 frames) do NOT penalize the score!
        if self.is_drowsy:
            attentiveness_score = 0.0
            status_message = "Drowsiness Alert"
        elif is_looking_away:
            attentiveness_score = 0.2
            status_message = pose_desc
        else:
            # Attentive (normal blinks maintain full score)
            attentiveness_score = 1.0
            status_message = "Attentive"

        return {
            "ear": float(avg_ear),
            "total_blinks": int(self.total_blinks),
            "attentiveness_score": float(attentiveness_score),
            "is_drowsy": bool(self.is_drowsy),
            "is_looking_away": bool(is_looking_away),
            "yaw_ratio": float(yaw_ratio),
            "pitch_ratio": float(pitch_ratio),
            "status_message": status_message
        }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Running validation tests on updated SpatialStream...")

    stream = SpatialStream(ear_threshold=0.21, consec_frames_blink=2, drowsy_limit=15)

    # 1. Synthesize mock landmarks for open eyes & centered head
    mock_coords = np.zeros((468, 2), dtype=np.int32)
    
    # Right Eye open: p1=(200, 240), p2=(220, 230), p3=(230, 230), p4=(250, 240), p5=(230, 250), p6=(220, 250)
    mock_coords[33] = [200, 240]
    mock_coords[160] = [220, 230]
    mock_coords[158] = [230, 230]
    mock_coords[133] = [250, 240]
    mock_coords[153] = [230, 250]
    mock_coords[144] = [220, 250]

    # Left Eye open: p1=(390, 240), p2=(410, 230), p3=(420, 230), p4=(440, 240), p5=(420, 250), p6=(410, 250)
    mock_coords[362] = [390, 240]
    mock_coords[385] = [410, 230]
    mock_coords[387] = [420, 230]
    mock_coords[263] = [440, 240]
    mock_coords[373] = [420, 250]
    mock_coords[380] = [410, 250]

    # Pose: Centered
    mock_coords[1] = [320, 240]   # Nose
    mock_coords[10] = [320, 140]  # Forehead (dist = 100)
    mock_coords[152] = [320, 340] # Chin (dist = 100)

    # Initial frame
    res = stream.process_landmarks(mock_coords)
    logging.info(f"Open eyes result: EAR={res['ear']:.3f}, Score={res['attentiveness_score']}, Status={res['status_message']}")
    assert res['attentiveness_score'] == 1.0
    assert not res['is_drowsy']

    # 2. Simulate a Natural Blink for 3 frames (EAR drops to 0.05)
    closed_coords = mock_coords.copy()
    # Flatten eye height
    closed_coords[160] = [220, 240]
    closed_coords[158] = [230, 240]
    closed_coords[153] = [230, 241]
    closed_coords[144] = [220, 241]
    closed_coords[385] = [410, 240]
    closed_coords[387] = [420, 240]
    closed_coords[373] = [420, 241]
    closed_coords[380] = [410, 241]

    for f in range(3):
        blink_res = stream.process_landmarks(closed_coords)
        # NATURAL BLINK MUST NOT TRIGGER ALERT OR PENALIZE SCORE
        assert not blink_res['is_drowsy'], "False positive drowsiness during blink!"
        assert blink_res['attentiveness_score'] == 1.0, "Score penalized during natural blink!"

    # Eyes reopen
    open_res = stream.process_landmarks(mock_coords)
    assert stream.total_blinks == 1, f"Expected 1 blink, got {stream.total_blinks}"
    logging.info(f"Blink debounced successfully! Total blinks: {stream.total_blinks}")

    # 3. Simulate Prolonged Eye Closure (>= 15 frames)
    for f in range(16):
        drowsy_res = stream.process_landmarks(closed_coords)
    assert drowsy_res['is_drowsy'], "Drowsiness failed to trigger after 16 frames!"
    assert drowsy_res['attentiveness_score'] == 0.0
    logging.info("Prolonged eye closure correctly triggered Drowsiness Alert.")

    # 4. Test Pitch Down (Looking down at lap/desk)
    pitch_coords = mock_coords.copy()
    # Chin moves closer to nose (foreshortened), forehead moves down
    pitch_coords[10] = [320, 100]  # dist to nose = 140
    pitch_coords[152] = [320, 310] # dist to nose = 70 -> pitch_ratio = 2.0
    pitch_res = stream.process_landmarks(pitch_coords)
    assert pitch_res['is_looking_away'], "Looking down not detected!"
    assert "Looking Down" in pitch_res['status_message']
    logging.info(f"Pitch detection passed: {pitch_res['status_message']}")

    logging.info("All SpatialStream kinematic validation tests PASSED!")
