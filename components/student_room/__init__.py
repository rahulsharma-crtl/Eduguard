import os
import streamlit.components.v1 as components

# Direct path to the student_room frontend build directory
_COMPONENT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
_student_room_component = components.declare_component("student_room", path=_COMPONENT_PATH)


def student_room(room_id: str, student_name: str, key: str = None):
    """
    Streamlit Custom Component for the Student Conference & Privacy Stream.

    Dual-pane interface:
    - Left pane: Receives and plays live teacher video/audio broadcast over WebRTC.
    - Right pane: Runs local in-browser MediaPipe FaceMesh wireframe on a solid black canvas.
    - WebRTC Bridge: Generates synthetic video stream via canvas.captureStream(25)
      and calls the teacher peer (${roomId}-teacher).
    - Local Kinematics: Computes 6-point EAR (with 15-frame blink debouncing) and head pose.
    - Dispatches computed CEI metrics back to Streamlit via setComponentValue.

    Args:
        room_id (str): Unique classroom identifier.
        student_name (str): The student's display name.
        key (str, optional): Streamlit component key.

    Returns:
        dict or None: Real-time telemetry payload containing cei_score, attentiveness,
                      distraction, presence, and status string.
    """
    clean_room_id = str(room_id).strip()
    clean_student_name = str(student_name).strip()
    return _student_room_component(
        roomId=clean_room_id,
        studentName=clean_student_name,
        key=key,
        default=None
    )
