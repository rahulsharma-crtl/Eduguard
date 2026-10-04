"""
Temporal Stream Processing Module
=================================
Purpose:
Applies sliding window smoothing algorithms over instantaneous spatial and object signals.
Filters out erratic signal noise to establish stable behavioral consistency scores over time.
"""

from collections import deque
import numpy as np
from typing import Dict, Any

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class TemporalStream:
    """
    Maintains historical observation sliding windows to calculate behavioral moving averages.
    """
    def __init__(self, window_size: int = CONFIG.TEMPORAL_WINDOW_SIZE):
        self.window_size = window_size
        
        self.attentiveness_history = deque(maxlen=window_size)
        self.distraction_history = deque(maxlen=window_size)
        self.presence_history = deque(maxlen=window_size)

    def smooth(self, attentiveness: float, distraction: float, presence: float) -> Dict[str, Any]:
        self.attentiveness_history.append(attentiveness)
        self.distraction_history.append(distraction)
        self.presence_history.append(presence)
        
        s_attentiveness = float(np.mean(self.attentiveness_history))
        s_distraction = float(np.mean(self.distraction_history))
        s_presence = float(np.mean(self.presence_history))
        
        return {
            "smoothed_attentiveness": s_attentiveness,
            "smoothed_distraction": s_distraction,
            "smoothed_presence": s_presence,
            "window_frames_collected": len(self.attentiveness_history)
        }

    def reset(self) -> None:
        self.attentiveness_history.clear()
        self.distraction_history.clear()
        self.presence_history.clear()
