import os
import streamlit.components.v1 as components

# Direct path to the built frontend directory
_COMPONENT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
_teacher_room_component = components.declare_component("teacher_room", path=_COMPONENT_PATH)


def teacher_room(room_id: str, live_students: dict = None, key: str = None):
    """
    Streamlit Custom Component for the Teacher Live Broadcast Room.
    
    Broadcasts the teacher's webcam and microphone feed over WebRTC (via PeerJS),
    hosts incoming student video streams, and renders dynamic floating CEI telemetry badges.
    
    Args:
        room_id (str): The unique classroom room identifier.
        live_students (dict, optional): Synced dictionary of active students and telemetry.
        key (str, optional): Streamlit component element key.
        
    Returns:
        dict or None: Optional event payload sent from the frontend.
    """
    clean_room_id = str(room_id).strip()
    return _teacher_room_component(
        roomId=clean_room_id,
        liveStudents=live_students or {},
        key=key,
        default=None
    )
