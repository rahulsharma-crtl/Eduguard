import os
import streamlit.components.v1 as components

# Get the absolute path to the frontend directory
_frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")

# Declare the component
# In a production environment, you would serve this via a built React app or static files.
# We are serving the raw HTML/JS directly for this edge-AI prototype.
_edge_tracker = components.declare_component(
    "edge_tracker",
    path=_frontend_dir
)

def edge_tracker(student_name: str, key=None):
    """
    Creates a new instance of the Edge AI Tracker component.
    
    Args:
        student_name: The name of the student to associate with the scores.
        key: An optional key that uniquely identifies this component.
        
    Returns:
        A dictionary containing the latest 'cei_score' and 'status' from the client's browser.
    """
    # The component returns whatever we pass to Streamlit.setComponentValue in JS.
    # We pass the student_name so the JS knows who it is tracking.
    component_value = _edge_tracker(student_name=student_name, key=key, default=None)
    return component_value
