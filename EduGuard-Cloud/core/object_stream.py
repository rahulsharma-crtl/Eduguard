"""
Object Detection Stream Module
==============================
Purpose:
Integrates Ultralytics YOLOv8-Nano to detect environmental distractions (phones, books)
and verify active physical presence. Optimized for real-time CPU constraints.
"""

import os
import time
import threading
import urllib.request
import logging
from typing import Optional, Dict, Any, List
import numpy as np

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class ObjectStream:
    """
    Asynchronous, frame-skipping object detection analyzer mapping active environmental state.
    """
    def __init__(self, weights_path: str = CONFIG.YOLO_WEIGHTS_PATH,
                 confidence_thresh: float = CONFIG.YOLO_CONFIDENCE_THRESH,
                 frame_skip: int = CONFIG.OBJECT_FRAME_SKIP):
        self.weights_path = weights_path
        self.confidence_thresh = confidence_thresh
        self.frame_skip = frame_skip
        
        self.target_classes = CONFIG.TARGET_CLASSES
        self.class_names = {0: "person", 67: "cell phone", 73: "book"}
        
        self.model: Optional[Any] = None
        self.model_ready: bool = False
        self.model_error: Optional[str] = None
        self.lock = threading.Lock()
        
        self.frame_counter: int = 0
        self.cached_result: Dict[str, Any] = {
            "person_detected": True,
            "distraction_score": 0.0,
            "detected_objects": [],
            "status_message": "Initializing Graph..."
        }
        
        self._start_async_loader()

    def _start_async_loader(self) -> None:
        loader_thread = threading.Thread(target=self._async_load_routine, name="YoloLoaderThread", daemon=True)
        loader_thread.start()

    def _async_load_routine(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.weights_path), exist_ok=True)
            
            if not os.path.exists(self.weights_path):
                logging.info(f"Local YOLO weights absent at '{self.weights_path}'. Fetching remote weights...")
                url = "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt"
                try:
                    urllib.request.urlretrieve(url, self.weights_path)
                    logging.info("YOLOv8n binary payload retrieved successfully.")
                except Exception as e:
                    logging.error(f"Network transport timeout retrieving weights: {e}")
                    with self.lock:
                        self.model_error = "Network fetch timeout."
                        self.cached_result["status_message"] = "Model Fetch Error"
                    return

            from ultralytics import YOLO
            
            model_instance = YOLO(self.weights_path)
            dummy_matrix = np.zeros((480, 640, 3), dtype=np.uint8)
            model_instance.predict(dummy_matrix, verbose=False, device="cpu")
            
            with self.lock:
                self.model = model_instance
                self.model_ready = True
                self.cached_result["status_message"] = "Object Graph Active"

        except Exception as ex:
            logging.error(f"Exception initializing object graph: {ex}")
            with self.lock:
                self.model_error = str(ex)
                self.cached_result["status_message"] = "Inference Disabled"

    def process_frame(self, frame: Optional[np.ndarray]) -> Dict[str, Any]:
        with self.lock:
            ready = self.model_ready
            model = self.model

        if not ready or frame is None:
            return self.cached_result.copy()

        self.frame_counter += 1
        if self.frame_counter % self.frame_skip != 0:
            return self.cached_result.copy()

        try:
            results = model.predict(frame, verbose=False, conf=self.confidence_thresh, device="cpu", classes=self.target_classes)
            
            person_detected = False
            detected_items: List[str] = []
            d_score = 0.0
            
            if results and len(results[0].boxes) > 0:
                boxes = results[0].boxes
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    
                    if cls_id == 0:
                        person_detected = True
                    elif cls_id == 67:
                        detected_items.append("cell phone")
                        d_score = max(d_score, 0.8)
                    elif cls_id == 73:
                        detected_items.append("book")
                        d_score = max(d_score, 0.4)

            if not person_detected:
                msg = "Person Absent"
            elif len(detected_items) > 0:
                msg = f"Distraction: {', '.join(set(detected_items))}"
            else:
                msg = "Clear Workspace"

            with self.lock:
                self.cached_result = {
                    "person_detected": person_detected,
                    "distraction_score": float(d_score),
                    "detected_objects": list(set(detected_items)),
                    "status_message": msg
                }
                
        except Exception as e:
            logging.warning(f"Inference processing frame dropout: {e}")

        return self.cached_result.copy()
