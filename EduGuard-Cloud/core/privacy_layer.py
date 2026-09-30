"""
Privacy-Preserving Layer Module
===============================
Purpose:
Extracts granular facial landmarks using MediaPipe Tasks Vision API.
Converts human face into abstract skeletal wireframe visualization.
Ensures zero storage or persistent rendering of original biometric pixels.
"""

import cv2
import numpy as np
import mediapipe as mp
import urllib.request
import os
import logging
from typing import Optional, Tuple, Any

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class PrivacyLayer:
    """
    Renders skeletal wireframes from raw video feeds while exporting reusable numerical landmarks.
    """
    def __init__(self, max_faces: int = 1):
        self.max_faces = max_faces
        self.landmarker: Optional[Any] = None
        self.vision: Optional[Any] = None
        
        self._ensure_asset_exists()
        self._initialize_framework()

    def _ensure_asset_exists(self) -> None:
        """
        Verifies and automatically downloads the Face Landmarker asset bundle if absent locally.
        """
        self.asset_path = os.path.join(CONFIG.MODEL_DIR, "face_landmarker.task")
        os.makedirs(CONFIG.MODEL_DIR, exist_ok=True)
        
        if not os.path.exists(self.asset_path):
            logging.info(f"Local MediaPipe asset absent at '{self.asset_path}'. Downloading base bundle...")
            url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
            try:
                urllib.request.urlretrieve(url, self.asset_path)
                logging.info("Face Landmarker asset retrieved successfully.")
            except Exception as e:
                logging.error(f"Network error retrieving Face Landmarker asset bundle: {e}")
        else:
            logging.info("Local Face Landmarker bundle verified successfully.")

    def _initialize_framework(self) -> None:
        """
        Instantiates Task Engine mapping to local CPU environments.
        """
        try:
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            
            self.vision = vision
            base_options = python.BaseOptions(model_asset_path=self.asset_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                output_face_blendshapes=False,
                output_facial_transformation_matrixes=False,
                num_faces=self.max_faces
            )
            self.landmarker = vision.FaceLandmarker.create_from_options(options)
            logging.info("MediaPipe Tasks Face Landmarker backend initialized successfully.")
        except Exception as ex:
            logging.error(f"Failed to bind MediaPipe Face Landmarker context: {ex}")

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, Optional[Any]]:
        """
        Executes real-time landmark inference graph.
        
        Returns:
            privacy_canvas: Synthetic black frame rendering only the abstract mesh wireframe.
            results: Raw result object payload exported to the Spatial Stream.
        """
        height, width, _ = frame.shape
        privacy_canvas = np.zeros((height, width, 3), dtype=np.uint8)
        
        if self.landmarker is None or self.vision is None:
            return privacy_canvas, None

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        
        try:
            results = self.landmarker.detect(mp_image)
            coords = self.extract_normalized_coords(results, width, height)
            if coords is not None:
                # Custom neon coral wireframe tessellation
                tess_color = (255, 107, 78) 
                for conn in self.vision.FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION:
                    pt1 = coords[conn.start]
                    pt2 = coords[conn.end]
                    cv2.line(privacy_canvas, tuple(pt1), tuple(pt2), tess_color, 1, cv2.LINE_AA)
                    
                # White contour outline
                contour_color = (255, 255, 255)
                for conn in self.vision.FaceLandmarksConnections.FACE_LANDMARKS_CONTOURS:
                    pt1 = coords[conn.start]
                    pt2 = coords[conn.end]
                    cv2.line(privacy_canvas, tuple(pt1), tuple(pt2), contour_color, 1, cv2.LINE_AA)
                    
            return privacy_canvas, results
        except Exception as e:
            logging.warning(f"MediaPipe inference loop fault: {e}")
            return privacy_canvas, None

    def extract_normalized_coords(self, results: Any, width: int, height: int) -> Optional[np.ndarray]:
        """
        Converts landmark objects into structured 2D NumPy array of pixel coordinates.
        """
        if not results or not hasattr(results, 'face_landmarks') or not results.face_landmarks:
            return None
            
        landmarks = results.face_landmarks[0]
        coords = np.array([(int(lm.x * width), int(lm.y * height)) for lm in landmarks])
        return coords

    def release(self) -> None:
        if self.landmarker is not None:
            try:
                self.landmarker.close()
            except:
                pass
