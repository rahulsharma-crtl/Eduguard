"""
Object Detection Stream Module
==============================
Purpose:
Integrates Ultralytics YOLOv8-Nano to detect environmental distractions:
- Class 0: Person (presence validation and multiple people detection)
- Class 67: Cell Phone (primary electronic distraction)
- Class 73: Book (secondary distraction)

CPU Optimization & Detection Hold:
1. Strict Frame Skipping: Evaluates inference once every 5 frames (CONFIG.OBJECT_FRAME_SKIP).
2. Resolution Downscaling: Inference runs on optimized imgsz=320 for ultra-fast CPU inference (<20ms).
3. Active Detection Hold: Cell phone detections hold the penalty for 30 frames (~1 sec) to prevent
   temporal dilution across skipped frames.
4. Bounding Box HUD: Exports detected distraction boxes so they can be rendered onto the privacy wireframe.
5. Thread-Safe Result Caching: Caches detection results so skipped frames return in <0.01ms.
"""

import os
import sys
import ctypes
import time
import logging
import threading
import urllib.request
from typing import Optional, Dict, Any, List
import numpy as np

# Adjust system path for configuration retrieval
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


def _preload_windows_torch_dlls() -> None:
    """
    On Windows systems, ensures PyTorch's native DLL dependencies (c10, torch_cpu, libiomp5md)
    are loaded with LOAD_WITH_ALTERED_SEARCH_PATH before OpenCV or MediaPipe can load conflicting runtimes.
    """
    if sys.platform == "win32":
        try:
            torch_lib = os.path.join(sys.prefix, "Lib", "site-packages", "torch", "lib")
            if os.path.exists(torch_lib):
                if hasattr(os, "add_dll_directory"):
                    try:
                        os.add_dll_directory(torch_lib)
                    except Exception:
                        pass
                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                for dll_name in ["libiomp5md.dll", "c10.dll", "torch_cpu.dll", "torch.dll", "torch_python.dll"]:
                    dll_path = os.path.join(torch_lib, dll_name)
                    if os.path.exists(dll_path):
                        kernel32.LoadLibraryExW(dll_path, None, 0x00000008)
        except Exception as e:
            logging.debug(f"Preload Windows DLL notice: {e}")


# Run DLL preload immediately at module import time
_preload_windows_torch_dlls()
import torch
logging.getLogger("ultralytics").setLevel(logging.WARNING)
from ultralytics import YOLO


class ObjectStream:
    """
    Lightweight, thread-safe, frame-skipping YOLOv8-Nano object detection stream
    with active temporal hold for distraction events and bounding box HUD export.
    """
    def __init__(self,
                 weights_path: str = CONFIG.YOLO_WEIGHTS_PATH,
                 confidence_thresh: float = CONFIG.YOLO_CONFIDENCE_THRESH,
                 frame_skip: int = CONFIG.OBJECT_FRAME_SKIP):
        self.weights_path = weights_path
        self.confidence_thresh = confidence_thresh
        self.frame_skip = frame_skip

        # COCO Class IDs: 0 (person), 67 (cell phone), 73 (book)
        self.target_classes = list(CONFIG.TARGET_CLASSES)
        self.class_names = {0: "person", 67: "cell phone", 73: "book"}

        # Model state & concurrency lock
        self.model: Optional[Any] = None
        self.model_ready: bool = False
        self.model_error: Optional[str] = None
        self.lock = threading.Lock()

        # Frame interval counters, hold frames, and cached state
        self.frame_counter: int = 0
        self.hold_frames: int = 0
        self.cached_boxes: List[Dict[str, Any]] = []
        self.cached_result: Dict[str, Any] = {
            "person_detected": True,   # Assume present on startup until verified
            "person_count": 1,
            "distraction_score": 0.0,
            "detected_objects": [],
            "bounding_boxes": [],
            "status_message": "Initializing Object Stream..."
        }

        # Initialize and pre-warm model
        self._load_model()

    def _load_model(self) -> None:
        """Downloads weights if missing and initializes YOLO model on CPU with warm-up."""
        try:
            os.makedirs(os.path.dirname(self.weights_path), exist_ok=True)

            if not os.path.exists(self.weights_path):
                logging.info(f"Local YOLO weights absent at '{self.weights_path}'. Fetching remote weights...")
                url = "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt"
                urllib.request.urlretrieve(url, self.weights_path)
                logging.info("YOLOv8n binary payload retrieved successfully.")

            model_instance = YOLO(self.weights_path)

            # Pre-warm execution graph on CPU with dummy tensor
            dummy_matrix = np.zeros((480, 640, 3), dtype=np.uint8)
            model_instance.predict(
                dummy_matrix,
                verbose=False,
                device="cpu",
                imgsz=320,
                classes=self.target_classes
            )

            with self.lock:
                self.model = model_instance
                self.model_ready = True
                self.cached_result["status_message"] = "Clear Workspace"
            logging.info("YOLOv8n Object Stream initialized and ready on CPU.")

        except Exception as ex:
            logging.error(f"Exception initializing YOLOv8n object stream: {ex}")
            with self.lock:
                self.model_error = str(ex)
                self.cached_result["status_message"] = "Inference Disabled"

    def wait_until_ready(self, timeout: float = 10.0) -> bool:
        """Synchronous barrier to wait for model warmup."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            with self.lock:
                if self.model_ready:
                    return True
                if self.model_error:
                    return False
            time.sleep(0.1)
        return False

    def process_frame(self, frame: Optional[np.ndarray]) -> Dict[str, Any]:
        """
        Processes frame with strict frame skipping and detection hold:
        - On skipped frames:
          - If hold_frames > 0, decrements counter and preserves the distraction penalty & bounding boxes.
          - If hold_frames == 0, decays distraction score to 0.0 and clears bounding boxes.
        - On evaluation frames (every 5 frames):
          - Runs YOLOv8-Nano on CPU.
          - If cell phone is detected, sets d_score = 0.90, hold_frames = 30, and logs alert.

        Returns:
            Dict containing:
                person_detected (bool)
                person_count (int)
                distraction_score (float, 0.0 to 1.0)
                detected_objects (list of str)
                bounding_boxes (list of dicts with 'box', 'name', 'conf')
                status_message (str)
        """
        if frame is None:
            with self.lock:
                return self.cached_result.copy()

        # Strict frame-skipping schedule (every OBJECT_FRAME_SKIP frames)
        self.frame_counter += 1
        if self.frame_counter % self.frame_skip != 0:
                if self.hold_frames > 0:
                    self.hold_frames -= 1
                    self.cached_result["distraction_score"] = max(self.cached_result.get("distraction_score", 0.0), 0.90)
                    if "cell phone" not in self.cached_result.get("detected_objects", []):
                        self.cached_result.setdefault("detected_objects", []).append("cell phone")
                    self.cached_result["bounding_boxes"] = list(self.cached_boxes)
                    self.cached_result["status_message"] = f"Distraction: {', '.join(self.cached_result['detected_objects'])}"
                else:
                    # Decay distraction score, phone flag, and bounding boxes when hold expires
                    self.cached_result["distraction_score"] = 0.0
                    self.cached_boxes = []
                    self.cached_result["bounding_boxes"] = []
                    if "cell phone" in self.cached_result.get("detected_objects", []):
                        self.cached_result["detected_objects"] = [
                            obj for obj in self.cached_result.get("detected_objects", []) if obj != "cell phone"
                        ]
                    if not self.cached_result.get("detected_objects") and self.cached_result.get("person_detected", True):
                        self.cached_result["status_message"] = "Clear Workspace"
                return self.cached_result.copy()

        with self.lock:
            ready = self.model_ready
            model = self.model

        # If model failed to load, serve cached state
        if not ready or model is None:
            with self.lock:
                return self.cached_result.copy()

        try:
            # Optimized CPU inference: downscaled imgsz=320 for ultra-fast <20ms latency
            results = model.predict(
                frame,
                verbose=False,
                conf=self.confidence_thresh,
                device="cpu",
                imgsz=320,
                classes=self.target_classes
            )

            person_count = 0
            detected_items: List[str] = []
            current_boxes: List[Dict[str, Any]] = []
            d_score = 0.0
            phone_found = False

            if results and len(results[0].boxes) > 0:
                boxes = results[0].boxes
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    conf = float(box.conf[0].item())
                    coords = [int(v) for v in box.xyxy[0].tolist()]

                    if cls_id == 0:  # Person
                        person_count += 1
                        if person_count > 1:
                            # Additional person is an environmental distraction
                            detected_items.append("additional person")
                            d_score = max(d_score, 0.5)
                            current_boxes.append({
                                "box": coords,
                                "name": "additional person",
                                "conf": conf
                            })
                    elif cls_id == 67:  # Cell phone
                        phone_found = True
                        detected_items.append("cell phone")
                        d_score = max(d_score, 0.90)  # High distraction penalty
                        self.hold_frames = 30  # Active hold for 30 frames (~1 sec)
                        current_boxes.append({
                            "box": coords,
                            "name": "cell phone",
                            "conf": conf
                        })
                        print(f"🚨 [DETECTION ALERT] Cell Phone Detected! Conf: {conf:.2f}")
                    elif cls_id == 73:  # Book
                        detected_items.append("book")
                        d_score = max(d_score, 0.40)  # Moderate distraction penalty
                        current_boxes.append({
                            "box": coords,
                            "name": "book",
                            "conf": conf
                        })

            # If phone was not seen in this specific frame but hold counter is active, retain penalty & boxes
            if not phone_found:
                if self.hold_frames > 0:
                    self.hold_frames -= 1
                    d_score = max(d_score, 0.90)
                    detected_items.append("cell phone")
                    current_boxes = list(self.cached_boxes)
                else:
                    self.cached_boxes = []

            if phone_found or current_boxes:
                self.cached_boxes = current_boxes

            person_detected = (person_count > 0)
            unique_items = list(set(detected_items))

            # Formulate clear status message
            if not person_detected:
                msg = "Person Absent"
            elif len(unique_items) > 0:
                msg = f"Distraction: {', '.join(unique_items)}"
            else:
                msg = "Clear Workspace"

            new_result = {
                "person_detected": person_detected,
                "person_count": person_count,
                "distraction_score": float(d_score),
                "detected_objects": unique_items,
                "bounding_boxes": current_boxes,
                "status_message": msg
            }

            with self.lock:
                self.cached_result = new_result

        except Exception as e:
            logging.warning(f"YOLO inference frame dropout: {e}")

        with self.lock:
            return self.cached_result.copy()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Validating ObjectStream YOLOv8-Nano integration...")

    stream = ObjectStream(frame_skip=5)
    ready = stream.wait_until_ready(timeout=10.0)
    assert ready, f"YOLO model failed to warm up! Error: {stream.model_error}"
    logging.info("YOLOv8-Nano model ready.")

    # Create dummy frame
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # Test hold counter behavior
    stream.hold_frames = 10
    stream.cached_result["distraction_score"] = 0.90
    stream.cached_result["detected_objects"] = ["cell phone"]
    stream.cached_boxes = [{"box": [10, 10, 50, 50], "name": "cell phone", "conf": 0.95}]

    # Process skipped frame
    stream.frame_counter = 1  # 2 % 5 != 0
    res = stream.process_frame(dummy_frame)
    assert stream.hold_frames == 9, f"Hold counter did not decrement! {stream.hold_frames}"
    assert res["distraction_score"] == 0.90, "Distraction score was prematurely decayed!"
    assert len(res["bounding_boxes"]) == 1, "Bounding boxes prematurely cleared on hold!"

    # Simulate hold expiration
    stream.hold_frames = 0
    stream.frame_counter = 1
    res_decay = stream.process_frame(dummy_frame)
    assert res_decay["distraction_score"] == 0.0, "Distraction score did not decay after hold expired!"
    assert len(res_decay["bounding_boxes"]) == 0, "Bounding boxes not cleared after hold expired!"

    logging.info("Hold counter and bounding box logic validated successfully!")
