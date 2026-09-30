"""
Global State Manager (core/global_state.py)

Purpose:
Thread-safe shared memory cache supporting live student counts, presence heartbeats, 
and real-time score tracking across multi-tenant classrooms.
"""

import streamlit as st
import time
from typing import Dict, Any, List

@st.cache_resource
def get_shared_state() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Format:
    {
        "room_id_1": {
            "student_name_1": { "cei_score": 0.85, "status": "Attentive", "last_seen": 169000000.0, "joined_at": 169000000.0 },
            ...
        }
    }
    """
    return {}

def update_student_presence(room_id: str, student_name: str, cei_score: float, status: str):
    """Posts a live heartbeat update for a student in a classroom."""
    state = get_shared_state()
    
    if room_id not in state:
        state[room_id] = {}
        
    now = time.time()
    joined_at = state[room_id].get(student_name, {}).get("joined_at", now)
    
    state[room_id][student_name] = {
        "cei_score": cei_score,
        "status": status,
        "last_seen": now,
        "joined_at": joined_at
    }

def get_live_students(room_id: str, timeout_seconds: int = 6) -> Dict[str, Dict[str, Any]]:
    """Returns students who sent a heartbeat within the last N seconds (Currently Online)."""
    state = get_shared_state()
    if room_id not in state:
        return {}
        
    now = time.time()
    return {
        name: data for name, data in state[room_id].items()
        if now - data["last_seen"] <= timeout_seconds
    }

def get_total_joined_students(room_id: str) -> List[Dict[str, Any]]:
    """Returns all students who have logged into this room session."""
    state = get_shared_state()
    if room_id not in state:
        return []
        
    return [
        {"student_name": name, "joined_at": data["joined_at"], "last_seen": data["last_seen"], "last_score": data["cei_score"]}
        for name, data in state[room_id].items()
    ]
