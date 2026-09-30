"""
EduGuard Cloud: Production Streamlit Architecture (app.py)

Key Optimization:
Replaces volatile script-level `st.rerun()` loops with a native in-place 
container stream loop (`while True` updating `st.empty()`). 
Eliminates DOM re-mounting, script execution lag, and browser flickering entirely.
"""

import streamlit as st
import numpy as np
import pandas as pd
import time
import logging
import cv2
import sys
import os
import uuid

sys.path.append(os.path.abspath(os.path.dirname(__file__)))
from config import CONFIG
from core.engine import CEIEngine
from core.db_manager import DatabaseManager
from core.reporting import generate_csv_report
from core import global_state
from core import dashboard_ui

# Page Setup
st.set_page_config(
    page_title="EduGuard Cloud | Privacy Analytics",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown(f"""
<style>
    .stApp {{
        background-color: {CONFIG.THEME_BG_COLOR};
        color: {CONFIG.THEME_TEXT_COLOR};
        font-family: 'Inter', sans-serif;
    }}
    div[data-testid="metric-container"] {{
        background: linear-gradient(135deg, rgba(78, 107, 255, 0.08), rgba(14, 17, 23, 0.6));
        border: 1px solid rgba(78, 107, 255, 0.2);
        padding: 1rem 1.2rem;
        border-radius: 12px;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
    }}
    .status-badge {{
        padding: 8px 16px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.9rem;
        display: inline-block;
        text-align: center;
        width: 100%;
    }}
    .status-normal {{ background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; color: #4ade80; }}
    .status-warn {{ background: rgba(234, 179, 8, 0.15); border: 1px solid #eab308; color: #facc15; }}
    .status-alert {{ background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #f87171; }}
</style>
""", unsafe_allow_html=True)

@st.cache_resource
def get_db_manager() -> DatabaseManager:
    return DatabaseManager()

db = get_db_manager()

# URL Query Params
query_params = st.query_params
room_from_url = query_params.get("room", None)

# Session State
if "role" not in st.session_state:
    st.session_state.role = None
if "username" not in st.session_state:
    st.session_state.username = ""
if "room_id" not in st.session_state:
    st.session_state.room_id = room_from_url
if "cei_history" not in st.session_state:
    st.session_state.cei_history = []
if "active_session_id" not in st.session_state:
    st.session_state.active_session_id = None
if "telemetry_buffer" not in st.session_state:
    st.session_state.telemetry_buffer = []
if "engine" not in st.session_state:
    st.session_state.engine = None


# ==========================================
# TEACHER PORTAL: LOGIN & ROOM CREATION
# ==========================================
if room_from_url is None and st.session_state.role != "Teacher":
    st.title("🛡️ EduGuard Cloud | Teacher Portal")
    st.markdown("Create a privacy-preserving smart classroom session and share the link with your students.")
    
    col1, _ = st.columns([1, 1])
    with col1:
        with st.form("create_room_form"):
            st.markdown("### Create New Classroom")
            teacher_pass = st.text_input("Teacher Admin Password", type="password", help="Default password is 'admin123'")
            room_name = st.text_input("Classroom Name (e.g., Math101)")
            submitted = st.form_submit_button("Launch Classroom", type="primary", use_container_width=True)
            
            if submitted:
                if teacher_pass != "admin123":
                    st.error("Incorrect Admin Password.")
                elif not room_name.strip():
                    st.error("Please provide a Classroom Name.")
                else:
                    clean_room = "".join(e for e in room_name if e.isalnum())
                    unique_room = f"EduGuard-{clean_room}-{uuid.uuid4().hex[:6]}"
                    st.session_state.role = "Teacher"
                    st.session_state.room_id = unique_room
                    st.rerun()

# ==========================================
# STUDENT PORTAL: JOIN ROOM
# ==========================================
elif room_from_url is not None and st.session_state.role != "Student":
    st.title("🧑‍🎓 Student Portal: Join Privacy Classroom")
    st.markdown(f"Classroom Target: **{room_from_url}**")
    
    col1, _ = st.columns([1, 1])
    with col1:
        with st.form("join_room_form"):
            student_name = st.text_input("Enter your Full Name:")
            joined = st.form_submit_button("Join Session", type="primary", use_container_width=True)
            
            if joined:
                if not student_name.strip():
                    st.error("Name cannot be empty.")
                else:
                    st.session_state.role = "Student"
                    st.session_state.username = student_name
                    st.session_state.room_id = room_from_url
                    global_state.update_student_presence(st.session_state.room_id, student_name, 1.0, "Attentive")
                    st.rerun()


# ==========================================
# TEACHER DASHBOARD VIEW
# ==========================================
if st.session_state.role == "Teacher":
    st.sidebar.markdown(f"### 👨‍🏫 Teacher Console")
    st.sidebar.success(f"Classroom: {st.session_state.room_id}")
    
    if st.sidebar.button("Logout / End Class Session"):
        st.session_state.role = None
        st.query_params.clear()
        st.rerun()

    # Shareable Student Link
    full_student_url = f"http://localhost:8501/?room={st.session_state.room_id}"
    st.markdown("### 📋 Student Shareable Link")
    st.text_input("Copy this FULL link and send it to your students:", value=full_student_url, key="share_link_box")
    st.caption("Students opening this link will bypass login and directly enter the Privacy Mesh session.")
    
    st.divider()
    
    # Teacher Dashboard Grid
    live_students = global_state.get_live_students(st.session_state.room_id, timeout_seconds=6)
    total_joined = global_state.get_total_joined_students(st.session_state.room_id)
    
    dashboard_ui.render_teacher_dashboard(live_students, total_joined)
    
    st.divider()
    
    # Completed Session CSV Export Table
    st.markdown("### 📥 Completed Session CSV Reports")
    sessions = db.get_all_sessions(room_id=st.session_state.room_id)
    
    if sessions:
        df_sess = pd.DataFrame(sessions)
        df_sess['start_time'] = pd.to_datetime(df_sess['start_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
        df_sess['end_time'] = pd.to_datetime(df_sess['end_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
        st.dataframe(df_sess.style.format({"avg_cei": "{:.1%}"}), use_container_width=True)
        
        selected_session = st.selectbox("Select Session ID for Export", [s["session_id"] for s in sessions])
        if st.button("Generate CSV Report", type="primary"):
            csv_data = generate_csv_report(db, selected_session)
            if csv_data:
                st.success("Report Compiled!")
                st.download_button(
                    label=f"⬇️ Download Session {selected_session} Telemetry CSV",
                    data=csv_data,
                    file_name=f"eduguard_session_{selected_session}.csv",
                    mime="text/csv",
                    use_container_width=True
                )
    
    time.sleep(2.0)
    st.rerun()


# ==========================================
# STUDENT PRIVACY WIREFRAME VIEW (NATIVE IN-PLACE STREAM)
# ==========================================
elif st.session_state.role == "Student":
    st.sidebar.markdown(f"### 🧑‍🎓 Student: {st.session_state.username}")
    st.sidebar.info("🛡️ Privacy Mode Active:\nYour facial mesh is processed locally on your device. Zero raw video is saved or transmitted.")
    
    stop_stream = st.sidebar.button("⏹️ Leave Classroom")
    
    st.title("📚 Interactive Privacy Classroom")
    st.caption("Live MediaPipe Face Mesh Wireframe Stream & Cognitive Engagement Evaluation.")
    
    # Pre-allocate containers ONCE in the DOM layout
    metric_cols = st.columns(4)
    col_cei = metric_cols[0].empty()
    col_att = metric_cols[1].empty()
    col_dis = metric_cols[2].empty()
    col_sts = metric_cols[3].empty()
    
    st.divider()
    
    stream_col, trend_col = st.columns([0.55, 0.45])
    
    with stream_col:
        st.subheader("🔴 Live Privacy Wireframe Feed")
        video_placeholder = st.empty()
        
    with trend_col:
        st.subheader("📈 Dynamic CEI Timeline")
        chart_placeholder = st.empty()

    if stop_stream:
        if st.session_state.engine and st.session_state.engine.is_running:
            st.session_state.engine.stop()
            st.session_state.engine = None
            
        if st.session_state.active_session_id is not None:
            if len(st.session_state.telemetry_buffer) > 0:
                db.insert_telemetry_batch(st.session_state.active_session_id, st.session_state.telemetry_buffer)
                st.session_state.telemetry_buffer.clear()
            avg_cei = float(np.mean(st.session_state.cei_history)) if len(st.session_state.cei_history) > 0 else 0.0
            db.end_session(st.session_state.active_session_id, time.time(), avg_cei)
            st.session_state.active_session_id = None
            
        st.session_state.role = None
        st.query_params.clear()
        st.rerun()

    # Initialize CEIEngine if needed
    if st.session_state.engine is None:
        st.session_state.engine = CEIEngine()
        st.session_state.engine.start()
        
    engine = st.session_state.engine
    
    if st.session_state.active_session_id is None:
        st.session_state.active_session_id = db.create_session(
            room_id=st.session_state.room_id,
            student_name=st.session_state.username,
            start_time=time.time()
        )
        
    frame_idx = 0
    
    # --- NATIVE IN-PLACE HIGH-PERFORMANCE VIDEO STREAM LOOP ---
    # Overwrites video_placeholder directly over WebSocket without invoking st.rerun()!
    while True:
        analytics = engine.step()
        frame_idx += 1
        
        cei = analytics["cei_score"]
        att = analytics["attentiveness"]
        dis = analytics["distraction"]
        msg = analytics["status_message"]
        alerts = analytics["alerts"]
        
        # 1. Direct Image Placeholder Update (Instant 30+ FPS)
        video_placeholder.image(analytics["privacy_canvas"], channels="BGR", use_container_width=True)
        
        # 2. Update Heartbeat & Telemetry
        global_state.update_student_presence(
            room_id=st.session_state.room_id,
            student_name=st.session_state.username,
            cei_score=cei,
            status=msg
        )
        
        st.session_state.telemetry_buffer.append({
            "timestamp": time.time(),
            "cei": cei,
            "attentiveness": att,
            "distraction": dis,
            "status": msg
        })
        
        if len(st.session_state.telemetry_buffer) >= 60:
            db.insert_telemetry_batch(st.session_state.active_session_id, st.session_state.telemetry_buffer)
            st.session_state.telemetry_buffer.clear()
            
        # 3. Update Heavy UI Metrics & Line Chart ONLY once per second (every 30 frames)
        if frame_idx % 30 == 0:
            col_cei.metric(label="Composite Engagement Index", value=f"{cei * 100:.1f}%")
            col_att.metric(label="Spatial Attentiveness Focus", value=f"{att * 100:.1f}%")
            col_dis.metric(label="Environmental Distraction Load", value=f"{dis * 100:.1f}%")
            
            badge_class = "status-normal"
            if len(alerts) > 0:
                badge_class = "status-alert"
            elif dis > 0.2 or att < 0.6:
                badge_class = "status-warn"
                
            col_sts.markdown(f'<div class="status-badge {badge_class}">{msg}</div>', unsafe_allow_html=True)
            
            st.session_state.cei_history.append(cei)
            if len(st.session_state.cei_history) > 100:
                st.session_state.cei_history.pop(0)
                
            df_trend = pd.DataFrame({"CEI Score": st.session_state.cei_history})
            chart_placeholder.line_chart(df_trend, height=340)
            
        time.sleep(0.03) # Smooth 30 FPS playback throttle
