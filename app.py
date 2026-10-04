import sys
import os
import ctypes

# CRITICAL WINDOWS DLL PRELOAD FOR TORCH/YOLO
# On Windows, PyTorch native C++ DLLs (c10.dll, libiomp5md.dll) MUST be preloaded 
# and imported BEFORE MediaPipe or OpenCV load conflicting runtimes.
if sys.platform == "win32":
    torch_lib = os.path.join(sys.prefix, "Lib", "site-packages", "torch", "lib")
    if os.path.exists(torch_lib):
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(torch_lib)
            except Exception:
                pass
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        for dll_name in ["libiomp5md.dll", "c10.dll", "torch_cpu.dll", "torch.dll", "torch_python.dll"]:
            dll_p = os.path.join(torch_lib, dll_name)
            if os.path.exists(dll_p):
                kernel32.LoadLibraryExW(dll_p, None, 0x00000008)

import torch
from ultralytics import YOLO

import streamlit as st
import numpy as np
import pandas as pd
import time
import logging
import cv2
import uuid

sys.path.append(os.path.abspath(os.path.dirname(__file__)))
from config import CONFIG
from core.engine import CEIEngine
from core.db_manager import DatabaseManager
from core.reporting import generate_csv_report
from core import global_state
from core import dashboard_ui
from components.teacher_room import teacher_room
from components.student_room import student_room

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
if "session_ended" not in st.session_state:
    st.session_state.session_ended = False


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
    if st.session_state.get("session_ended", False):
        st.sidebar.markdown("### 👨‍🏫 Teacher Console")
        st.sidebar.info(f"Classroom `{st.session_state.room_id}` Concluded")
        if st.sidebar.button("🔄 Return to Login / New Classroom", type="primary", use_container_width=True):
            st.session_state.session_ended = False
            st.session_state.role = None
            st.session_state.room_id = None
            st.query_params.clear()
            st.rerun()

        summary_ledger = db.get_room_session_summary_ledger(st.session_state.room_id)
        dashboard_ui.render_session_summary_ledger(summary_ledger, st.session_state.room_id)

        st.divider()
        if st.button("⬅️ Exit to Login Screen"):
            st.session_state.session_ended = False
            st.session_state.role = None
            st.session_state.room_id = None
            st.query_params.clear()
            st.rerun()

    else:
        st.sidebar.markdown(f"### 👨‍🏫 Teacher Console")
        st.sidebar.success(f"Classroom: {st.session_state.room_id}")
        
        if st.sidebar.button("🛑 Logout / End Class Session", type="primary", use_container_width=True):
            st.session_state.session_ended = True
            st.rerun()

        # Shareable Student Link
        full_student_url = f"http://localhost:8501/?room={st.session_state.room_id}"
        st.markdown("### 📋 Student Shareable Link")
        st.text_input("Copy this FULL link and send it to your students:", value=full_student_url, key="share_link_box")
        st.caption("Students opening this link will bypass login and directly enter the Privacy Mesh session.")
        
        st.divider()
        
        # Live Classroom Video Broadcast (WebRTC Peer Room with Zero Video Decode Participant Roster)
        st.markdown("### 🎥 Live Classroom Broadcast & Participant Roster")
        live_students = global_state.get_live_students(st.session_state.room_id, timeout_seconds=6)
        teacher_room(st.session_state.room_id, live_students=live_students, key="teacher_broadcast_component")
        
        st.divider()
        
        # Teacher Dashboard Grid (Auto-refreshes metrics without disrupting WebRTC video)
        @st.fragment(run_every="3s")
        def render_teacher_telemetry():
            live_students = global_state.get_live_students(st.session_state.room_id, timeout_seconds=6)
            total_joined = global_state.get_total_joined_students(st.session_state.room_id)
            dashboard_ui.render_teacher_dashboard(live_students, total_joined)
            
        render_teacher_telemetry()
        
        st.divider()
        
        # Completed Session CSV Export Table
        st.markdown("### 📥 Completed Session CSV Reports")
        sessions = db.get_all_sessions(room_id=st.session_state.room_id)
        
        if sessions:
            df_sess = pd.DataFrame(sessions)
            df_sess['start_time'] = pd.to_datetime(df_sess['start_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
            df_sess['end_time'] = pd.to_datetime(df_sess['end_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
            df_sess['avg_cei'] = df_sess['avg_cei'].fillna(0.0)
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


# ==========================================
# STUDENT PRIVACY CONFERENCE VIEW (WEBRTC + MEDIAPIPE)
# ==========================================
elif st.session_state.role == "Student":
    st.sidebar.markdown(f"### 🧑‍🎓 Student: {st.session_state.username}")
    st.sidebar.info("🛡️ Privacy Mode Active:\nYour facial mesh is processed locally in your browser. Zero raw video is saved or transmitted.")
    
    stop_stream = st.sidebar.button("⏹️ Leave Classroom")
    
    if stop_stream:
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

    st.title("📚 Interactive Privacy Classroom")
    st.caption("Live In-Browser MediaPipe Mesh, WebRTC Lecture Stream & Real-Time Engagement Telemetry.")

    if st.session_state.active_session_id is None:
        st.session_state.active_session_id = db.create_session(
            room_id=st.session_state.room_id,
            student_name=st.session_state.username,
            start_time=time.time()
        )

    # Render Student WebRTC Conference & Local Privacy Mesh Component
    telemetry = student_room(
        room_id=st.session_state.room_id,
        student_name=st.session_state.username,
        key="student_conference_view"
    )

    # Process incoming real-time kinematics and engagement dispatch
    if telemetry and isinstance(telemetry, dict):
        cei = float(telemetry.get("cei_score", 1.0))
        att = float(telemetry.get("attentiveness", 1.0))
        dis = float(telemetry.get("distraction", 0.0))
        msg = str(telemetry.get("status", "Attentive"))

        # Update Live Heartbeat & Telemetry
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

        # Batch insert into SQLite every 10 records (~5s) for instant CSV export readiness
        if len(st.session_state.telemetry_buffer) >= 10:
            db.insert_telemetry_batch(st.session_state.active_session_id, st.session_state.telemetry_buffer)
            st.session_state.telemetry_buffer.clear()

        st.session_state.cei_history.append(cei)
        if len(st.session_state.cei_history) > 100:
            st.session_state.cei_history.pop(0)

    # Real-Time CEI Engagement Trend Chart
    if len(st.session_state.cei_history) > 1:
        st.divider()
        st.subheader("📈 Live Engagement Timeline (Session Progress)")
        df_trend = pd.DataFrame({"CEI Engagement Score": st.session_state.cei_history})
        st.line_chart(df_trend, height=220)


