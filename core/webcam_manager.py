"""
Webcam Manager Module
=====================
Purpose:
Captures live webcam stream using OpenCV in a dedicated background daemon thread.
Ensures downstream consumer modules always receive the freshest available frame with zero I/O lag.
"""

import cv2
import threading
import time
import logging
from typing import Optional, Tuple
import numpy as np

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


class WebcamManager:
    """
    Multi-threaded, highly optimized webcam acquisition daemon.
    """
    def __init__(self, camera_index: int = CONFIG.CAMERA_INDEX, 
                 width: int = CONFIG.FRAME_WIDTH, 
                 height: int = CONFIG.FRAME_HEIGHT):
        self.camera_index = camera_index
        self.width = width
        self.height = height
        
        self.cap: Optional[cv2.VideoCapture] = None
        self.grabbed: bool = False
        self.frame: Optional[np.ndarray] = None
        self.lock = threading.Lock()
        
        self.running: bool = False
        self.thread: Optional[threading.Thread] = None
        self.frame_count: int = 0

    def start(self) -> bool:
        """
        Initializes the VideoCapture hardware and launches the async worker thread.
        """
        logging.info(f"Initializing Webcam hardware on device index: {self.camera_index}")
        self.cap = cv2.VideoCapture(self.camera_index)
        
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        
        if not self.cap.isOpened():
            logging.error(f"Failed to open hardware device index {self.camera_index}.")
            return False
            
        self.grabbed, raw_frame = self.cap.read()
        if self.grabbed and raw_frame is not None:
            self.frame = cv2.resize(raw_frame, (self.width, self.height))
        else:
            logging.error("Hardware device opened but initial frame read failed.")
            return False

        self.running = True
        self.thread = threading.Thread(target=self._update, name="WebcamIngestDaemon", daemon=True)
        self.thread.start()
        logging.info("Webcam ingest worker thread started successfully.")
        return True

    def _update(self) -> None:
        """
        Continuous internal daemon routine keeping the active frame buffer saturated.
        """
        while self.running:
            if self.cap is None or not self.cap.isOpened():
                break
                
            grabbed, raw_frame = self.cap.read()
            if grabbed and raw_frame is not None:
                resized = cv2.resize(raw_frame, (self.width, self.height))
                with self.lock:
                    self.grabbed = grabbed
                    self.frame = resized
                    self.frame_count += 1
            else:
                time.sleep(0.005)

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        """
        Thread-safe extraction method for downstream modules to fetch the current fresh frame.
        """
        with self.lock:
            if self.frame is not None:
                return self.grabbed, self.frame.copy()
            return False, None

    def stop(self) -> None:
        """
        Gracefully terminates execution loop and releases hardware locks.
        """
        logging.info("Stopping Webcam ingest worker thread...")
        self.running = False
        if self.thread is not None and self.thread.is_alive():
            self.thread.join(timeout=2.0)
            
        if self.cap is not None:
            self.cap.release()
        logging.info("Webcam hardware released successfully.")
