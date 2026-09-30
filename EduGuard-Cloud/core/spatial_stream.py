"""
Spatial Stream Processing Module
================================
Purpose:
Computes instantaneous attentiveness metrics directly from extracted facial landmark arrays.
Calculates Eye Aspect Ratio (EAR) for blink and drowsiness tracking, alongside lightweight
2D head pose heuristics to detect screen aversion.
"""

import numpy as np
from typing import Optional, Dict, Any
import logging

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class SpatialStream:
    """
    Analyzes geometric facial point configurations to quantify attentiveness and visual presence.
    """
    def __init__(self, ear_threshold: float = CONFIG.EAR_THRESHOLD,
                 consec_frames_blink: int = CONFIG.EAR_CONSEC_FRAMES,
                 drowsy_limit: int = CONFIG.DROWSINESS_FRAME_LIMIT):
        self.ear_threshold = ear_threshold
        self.consec_frames_blink = consec_frames_blink
        self.drowsy_limit = drowsy_limit
        
        self.blink_counter: int = 0
        self.total_blinks: int = 0
        self.drowsy_counter: int = 0
        
        self.LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
        self.RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
        
        self.NOSE_TIP = 1
        self.LEFT_EYE_CORNER = 263
        self.RIGHT_EYE_CORNER = 33

    def _compute_ear(self, eye_points: np.ndarray) -> float:
        v1 = np.linalg.norm(eye_points[1] - eye_points[5])
        v2 = np.linalg.norm(eye_points[2] - eye_points[4])
        h = np.linalg.norm(eye_points[0] - eye_points[3])
        
        if h < 1e-6:
            return 0.0
            
        ear = (v1 + v2) / (2.0 * h)
        return float(ear)

    def _check_head_aversion(self, coords: np.ndarray) -> bool:
        nose_x = coords[self.NOSE_TIP][0]
        left_corner_x = coords[self.LEFT_EYE_CORNER][0]
        right_corner_x = coords[self.RIGHT_EYE_CORNER][0]
        
        dist_right = nose_x - right_corner_x
        dist_left = left_corner_x - nose_x
        
        nose_y = coords[self.NOSE_TIP][1]
        forehead_y = coords[10][1]
        chin_y = coords[152][1]
        
        dist_up = nose_y - forehead_y
        dist_down = chin_y - nose_y
        
        if dist_right < 1 or dist_left < 1 or dist_up < 1 or dist_down < 1:
            return True 
            
        horiz_ratio = dist_left / float(dist_right)
        vert_ratio = dist_up / float(dist_down)
        
        if horiz_ratio < 0.5 or horiz_ratio > 2.0:
            return True
            
        if vert_ratio > 1.8 or vert_ratio < 0.5:
            return True
            
        return False

    def process_landmarks(self, coords: Optional[np.ndarray]) -> Dict[str, Any]:
        if coords is None or len(coords) < 468:
            self.drowsy_counter = 0
            return {
                "ear": 0.0,
                "total_blinks": self.total_blinks,
                "attentiveness_score": 0.0,
                "is_drowsy": False,
                "is_looking_away": True,
                "status_message": "Subject Absent"
            }

        left_eye = coords[self.LEFT_EYE_INDICES]
        right_eye = coords[self.RIGHT_EYE_INDICES]
        
        ear_left = self._compute_ear(left_eye)
        ear_right = self._compute_ear(right_eye)
        avg_ear = (ear_left + ear_right) / 2.0
        
        is_drowsy = False
        if avg_ear < self.ear_threshold:
            self.blink_counter += 1
            self.drowsy_counter += 1
            if self.drowsy_counter >= self.drowsy_limit:
                is_drowsy = True
        else:
            if self.consec_frames_blink <= self.blink_counter < self.drowsy_limit:
                self.total_blinks += 1
            self.blink_counter = 0
            self.drowsy_counter = 0
            
        is_looking_away = self._check_head_aversion(coords)
        
        if is_drowsy:
            score = 0.0
            msg = "Drowsiness Alert"
        elif is_looking_away:
            score = 0.2
            msg = "Looking Away"
        else:
            score = 1.0 if avg_ear >= (self.ear_threshold + 0.05) else 0.8
            msg = "Attentive"
            
        return {
            "ear": float(avg_ear),
            "total_blinks": self.total_blinks,
            "attentiveness_score": float(score),
            "is_drowsy": is_drowsy,
            "is_looking_away": is_looking_away,
            "status_message": msg
        }
