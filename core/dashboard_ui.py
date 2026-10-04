"""
Teacher Dashboard UI (core/dashboard_ui.py)

Purpose:
Renders a real-time, responsive grid of active students, online student counts,
and student attendance rosters for the teacher's view.
"""

import streamlit as st
import pandas as pd
import html
import time

def apply_global_styles():
    """Injects dark-mode CSS styling."""
    st.markdown("""
    <style>
    .stApp { background-color: #0d1117; color: #c9d1d9; }
    .student-card {
        background: linear-gradient(135deg, rgba(22, 27, 34, 0.95), rgba(13, 17, 23, 0.95));
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 15px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
    }
    .student-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }
    .student-name { font-size: 1.1rem; font-weight: 700; color: #58a6ff; }
    .status-badge {
        padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    }
    .status-Attentive { background: rgba(46, 160, 67, 0.2); color: #56d364; border: 1px solid #2ea043; }
    .status-Drowsy { background: rgba(248, 81, 73, 0.2); color: #ff7b72; border: 1px solid #f85149; }
    .status-Distracted { background: rgba(210, 153, 34, 0.2); color: #e3b341; border: 1px solid #d29922; }
    </style>
    """, unsafe_allow_html=True)

def draw_student_card(name: str, data: dict):
    """Renders a single student's live card."""
    score = data.get("cei_score", 0.0)
    score_pct = int(score * 100) if score <= 1.0 else int(score)
    
    raw_status = data.get("status", "Unknown")
    status_class = "Attentive"
    if "Drowsy" in raw_status: status_class = "Drowsy"
    elif "Distracted" in raw_status or "Away" in raw_status or "Absent" in raw_status: status_class = "Distracted"
    
    safe_name = html.escape(name)
    safe_status = html.escape(raw_status)
    
    html_content = f"""
    <div class="student-card">
        <div class="student-header">
            <div class="student-name">🧑‍🎓 {safe_name}</div>
            <div class="status-badge status-{status_class}">{safe_status}</div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <div>
                <span style="font-size: 2rem; font-weight: 800; color: #ffffff;">{score_pct}%</span>
                <span style="color:#8b949e; font-size: 0.85rem;">CEI Focus</span>
            </div>
            <div style="font-size: 0.8rem; color: #56d364; font-weight: 600;">
                🟢 Online Now
            </div>
        </div>
    </div>
    """
    st.markdown(html_content, unsafe_allow_html=True)

def render_teacher_dashboard(live_students: dict, total_joined: list):
    """Renders teacher analytics console with real-time student counts."""
    apply_global_styles()
    
    st.title("👨‍🏫 Teacher Analytics Console")
    st.markdown("Live Multi-Tenant Classroom Focus & Student Roster Monitor")
    
    st.divider()
    
    # 1. Top Metrics Header (Active vs Total Joined)
    col1, col2, col3 = st.columns(3)
    
    num_online = len(live_students)
    num_total = len(total_joined)
    
    avg_score = 0.0
    if num_online > 0:
        scores = [d.get("cei_score", 0.0) for d in live_students.values()]
        avg_score = sum(scores) / num_online
        if avg_score <= 1.0:
            avg_score *= 100
            
    with col1:
        st.metric("🟢 Students Currently Online", num_online)
    with col2:
        st.metric("👥 Total Students Joined Class", num_total)
    with col3:
        st.metric("📊 Live Class Focus Average", f"{avg_score:.1f}%")
        
    st.divider()
    
    # 2. Live Student Cards (Currently Online)
    st.markdown("### 🟢 Live Active Students")
    if not live_students:
        st.info("No students are currently active in the live stream right now.")
    else:
        cols = st.columns(3)
        for idx, (name, data) in enumerate(live_students.items()):
            with cols[idx % 3]:
                draw_student_card(name, data)
                
    st.divider()
    
    # 3. Class Attendance Roster Table
    st.markdown("### 📋 Student Class Attendance Roster")
    if not total_joined:
        st.info("No students have joined this classroom session yet.")
    else:
        df_roster = pd.DataFrame(total_joined)
        df_roster['Joined At'] = pd.to_datetime(df_roster['joined_at'], unit='s').dt.strftime('%H:%M:%S')
        df_roster['Last Active'] = pd.to_datetime(df_roster['last_seen'], unit='s').dt.strftime('%H:%M:%S')
        df_roster['Last CEI Score'] = (df_roster['last_score'] * 100).round(1).astype(str) + '%'
        df_roster = df_roster[['student_name', 'Joined At', 'Last Active', 'Last CEI Score']]
        df_roster.columns = ['Student Name', 'Joined At', 'Last Active', 'Last CEI Focus']
        
        st.dataframe(df_roster, use_container_width=True)

def render_session_summary_ledger(ledger: list, room_id: str):
    """
    Renders the finalized Session-End Engagement Aggregation and Ledger
    with Student Name, Total Time Present, Final CEI Score %, Primary Attention State,
    and a one-click CSV export button.
    """
    apply_global_styles()

    st.title("🎓 Session Concluded — Engagement Summary Ledger")
    st.markdown(f"**Classroom Target:** `{room_id}` | **Session Aggregation Report**")
    st.info("The lecture session has been closed. Below is the finalized attendance, engagement scores, and primary attention state compiled from local SQLite telemetry.")

    if not ledger:
        st.warning("No student telemetry records were captured during this classroom session.")
        return

    # 1. Top Summary Cards
    total_students = len(ledger)
    avg_session_cei = sum(s["avg_cei_pct"] for s in ledger) / total_students if total_students > 0 else 0.0
    attentive_count = sum(1 for s in ledger if "Attentive" in s.get("primary_state", ""))

    c1, c2, c3 = st.columns(3)
    with c1:
        st.metric("👥 Total Students Attended", total_students)
    with c2:
        st.metric("📊 Session Average Focus (CEI)", f"{avg_session_cei:.1f}%")
    with c3:
        st.metric("🎯 Primarily Attentive", f"{attentive_count} / {total_students}")

    st.divider()

    # 2. Detailed Summary Table
    st.markdown("### 📋 Final Student Engagement Ledger")
    df = pd.DataFrame(ledger)
    
    display_df = df[[
        "student_name",
        "duration_str",
        "avg_cei_pct",
        "primary_state"
    ]].copy()

    display_df.columns = [
        "Student Name",
        "Total Time Present / Attended",
        "Final Session Average Engagement Score (%)",
        "Primary Attention State"
    ]

    st.dataframe(
        display_df,
        use_container_width=True,
        hide_index=True
    )

    st.divider()

    # 3. CSV Export Option
    st.markdown("### 📥 Export Final Session Ledger")
    csv_bytes = display_df.to_csv(index=False).encode('utf-8')
    st.download_button(
        label="⬇️ Download Finalized Attendance & Score Ledger (CSV)",
        data=csv_bytes,
        file_name=f"EduGuard_{room_id}_Session_Ledger.csv",
        mime="text/csv",
        type="primary",
        use_container_width=True
    )
