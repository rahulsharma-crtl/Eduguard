"""
Privacy-Preserving Layer Module
===============================
Purpose:
Extracts 3D/2D facial landmarks using the modern MediaPipe Tasks Vision API.
Strictly converts the human face into an anonymized, abstract neon wireframe on a solid black canvas.
Ensures zero storage, transmission, or rendering of raw camera frames or biometric textures.
Exports 2D landmark coordinates scaled to the exact pixel dimensions of the input frame.
"""

import os
import sys
import urllib.request
import logging
from typing import Optional, Tuple, Any
import cv2
import numpy as np

# Adjust system path for configuration retrieval
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class PrivacyLayer:
    """
    Extracts facial landmarks and renders an anonymized neon wireframe on an empty black canvas.
    Raw camera frames and biometric textures are never saved, persisted, or displayed.
    """
    def __init__(self, max_faces: int = 1):
        self.max_faces = max_faces
        self.landmarker: Optional[Any] = None
        self.vision: Optional[Any] = None
        self.latest_coords: Optional[np.ndarray] = None
        
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
                logging.info("Face Landmarker asset bundle retrieved successfully.")
            except Exception as e:
                logging.error(f"Network error retrieving Face Landmarker asset bundle: {e}")
        else:
            logging.info("Local Face Landmarker bundle verified successfully.")

    def _initialize_framework(self) -> None:
        """
        Instantiates the MediaPipe FaceLandmarker Task Engine for local CPU environments.
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
            logging.info("MediaPipe FaceLandmarker engine initialized successfully.")
        except Exception as ex:
            logging.error(f"Failed to bind MediaPipe FaceLandmarker context: {ex}")

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, Optional[Any]]:
        """
        Processes a raw input frame in memory:
        1. Performs MediaPipe face landmark detection.
        2. Strictly paints an anonymized neon wireframe on a pitch-black canvas.
           (Zero raw camera pixels or textures are retained).
        3. Caches and exports scaled 2D landmark coordinates.

        Args:
            frame: Input BGR numpy image frame from webcam.

        Returns:
            privacy_canvas: Pure black image with neon facial wireframes.
            results: Raw MediaPipe detection results payload.
        """
        height, width, _ = frame.shape
        # Strictly initialize a pitch-black canvas with zero biometric textures
        privacy_canvas = np.zeros((height, width, 3), dtype=np.uint8)
        self.latest_coords = None
        
        if self.landmarker is None or self.vision is None:
            return privacy_canvas, None

        # Format image to RGB for MediaPipe inference (processed in-memory only)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        import mediapipe as mp
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        
        try:
            results = self.landmarker.detect(mp_image)
            coords = self.extract_normalized_coords(results, width, height)
            self.latest_coords = coords
            
            if coords is not None and len(coords) > 0:
                # 1. Subtle Neon Cyan/Green Tessellation Mesh (Interior Structure)
                tess_color = (180, 255, 0)  # Bright neon green-cyan in BGR
                for conn in self.vision.FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION:
                    pt1 = coords[conn.start]
                    pt2 = coords[conn.end]
                    cv2.line(privacy_canvas, tuple(pt1), tuple(pt2), tess_color, 1, cv2.LINE_AA)
                    
                # 2. Prominent Neon Contours (Face Oval, Eyes, Brows, Lips)
                contour_color = (255, 230, 80)  # Vibrant electric cyan in BGR
                for conn in self.vision.FaceLandmarksConnections.FACE_LANDMARKS_CONTOURS:
                    pt1 = coords[conn.start]
                    pt2 = coords[conn.end]
                    cv2.line(privacy_canvas, tuple(pt1), tuple(pt2), contour_color, 1, cv2.LINE_AA)

                # 3. Iris Highlights if available
                if hasattr(self.vision.FaceLandmarksConnections, 'FACE_LANDMARKS_IRISES'):
                    iris_color = (80, 160, 255)  # Neon amber/coral in BGR
                    for conn in self.vision.FaceLandmarksConnections.FACE_LANDMARKS_IRISES:
                        pt1 = coords[conn.start]
                        pt2 = coords[conn.end]
                        cv2.line(privacy_canvas, tuple(pt1), tuple(pt2), iris_color, 1, cv2.LINE_AA)

            return privacy_canvas, results
            
        except Exception as e:
            logging.warning(f"MediaPipe inference loop fault: {e}")
            return privacy_canvas, None

    def extract_normalized_coords(self, results: Any, width: int, height: int) -> Optional[np.ndarray]:
        """
        Converts normalized landmarks [0.0, 1.0] to exact 2D pixel coordinates scaled
        to the exact width and height of the input frame. Clamps values safely within frame boundaries.

        Args:
            results: MediaPipe detection results object.
            width: Exact pixel width of input frame.
            height: Exact pixel height of input frame.

        Returns:
            Numpy array of shape (num_landmarks, 2) with dtype int32, or None if no face detected.
        """
        if not results or not hasattr(results, 'face_landmarks') or not results.face_landmarks:
            return None
            
        landmarks = results.face_landmarks[0]
        coords = np.array([
            (
                int(np.clip(round(lm.x * width), 0, width - 1)),
                int(np.clip(round(lm.y * height), 0, height - 1))
            )
            for lm in landmarks
        ], dtype=np.int32)
        return coords

    def release(self) -> None:
        """Cleans up task handles safely."""
        if self.landmarker is not None:
            try:
                self.landmarker.close()
            except Exception:
                pass
            self.landmarker = None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Validating PrivacyLayer standalone execution...")
    
    layer = PrivacyLayer()
    dummy_frame = np.ones((480, 640, 3), dtype=np.uint8) * 128
    canvas, res = layer.process_frame(dummy_frame)
    
    assert canvas.shape == (480, 640, 3), "Canvas shape mismatch!"
    # Ensure background remains strictly black when no face is present
    assert np.all(canvas == 0), "Canvas is not pure black when no face detected!"
    
    logging.info(f"PrivacyLayer validated successfully. Canvas shape: {canvas.shape}")
    layer.release()
