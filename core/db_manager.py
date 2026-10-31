"""
Database Management Module
==========================
Purpose:
Provides local, CPU-optimized, offline-first persistent storage using SQLite.
Stores multi-room session metadata and telemetry for post-lecture analysis.
"""

import sqlite3
from contextlib import contextmanager
import os
import logging
import hashlib
import json
from typing import List, Dict, Any, Optional
import time

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import CONFIG


class DatabaseManager:
    """
    Manages lightweight local database connections and optimized CRUD operations.
    """
    def __init__(self, db_path: str = "eduguard_telemetry.db"):
        self.db_path = os.path.join(os.path.dirname(__file__), "..", db_path)
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=20.0, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=FULL")
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        query_sessions = '''
        CREATE TABLE IF NOT EXISTS sessions (
            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL DEFAULT 'default',
            student_name TEXT NOT NULL DEFAULT 'Anonymous',
            start_time REAL NOT NULL,
            end_time REAL,
            avg_cei REAL
        )
        '''
        query_telemetry = '''
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            cei REAL NOT NULL,
            attentiveness REAL NOT NULL,
            distraction REAL NOT NULL,
            status TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(session_id)
        )
        '''
        try:
            with self._get_connection() as conn:
                conn.execute(query_sessions)
                conn.execute(query_telemetry)
                conn.execute("""CREATE TABLE IF NOT EXISTS legacy_attendance_intervals(
                    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
                    started_at REAL NOT NULL,last_seen REAL NOT NULL,ended_at REAL)""")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_legacy_intervals_session ON legacy_attendance_intervals(session_id)")
                if "last_seen" not in {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}:
                    conn.execute("ALTER TABLE sessions ADD COLUMN last_seen REAL")
                    conn.execute("UPDATE sessions SET last_seen = COALESCE((SELECT MAX(timestamp) FROM telemetry WHERE telemetry.session_id = sessions.session_id), start_time)")
                if "sample_id" not in {row[1] for row in conn.execute("PRAGMA table_info(telemetry)")}:
                    conn.execute("ALTER TABLE telemetry ADD COLUMN sample_id TEXT")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_sample_id ON telemetry(session_id, sample_id) WHERE sample_id IS NOT NULL")
                for name, sql_type in [('participant_id','TEXT'),('session_status','TEXT')]:
                    if name not in {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}:
                        conn.execute(f"ALTER TABLE sessions ADD COLUMN {name} {sql_type}")
                conn.execute("UPDATE sessions SET participant_id='legacy-session-' || session_id WHERE participant_id IS NULL")
                conn.execute("UPDATE sessions SET session_status=CASE WHEN end_time IS NULL THEN 'stale' ELSE 'completed' END WHERE session_status IS NULL")
                conn.execute("CREATE TABLE IF NOT EXISTS legacy_schema_migrations(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
                conn.execute("INSERT OR IGNORE INTO legacy_schema_migrations VALUES(2,?)",(time.time(),))
                conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(room_id,participant_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_session_id ON telemetry(session_id)")
                conn.commit()
            logging.info("SQLite Database initialized successfully.")
        except Exception as e:
            logging.error(f"Failed to initialize SQLite schemas: {e}")
            raise

    def create_session(self, room_id: str, student_name: str, start_time: float, participant_id: Optional[str] = None) -> Optional[int]:
        """Registers a new student session under a specific classroom room_id."""
        try:
            with self._get_connection() as conn:
                if participant_id:
                    previous=conn.execute("SELECT session_id FROM sessions WHERE room_id=? AND participant_id=? AND session_status IN ('active','stale') ORDER BY session_id DESC LIMIT 1",(room_id,participant_id)).fetchone()
                    if previous:
                        self._pulse_legacy(conn,previous[0],time.time())
                        return previous[0]
                cursor = conn.execute(
                    "INSERT INTO sessions (room_id, student_name, start_time, last_seen,participant_id,session_status) VALUES (?, ?, ?, ?, ?, 'active')",
                    (room_id, student_name, start_time, start_time, participant_id or __import__("uuid").uuid4().hex)
                )
                self._pulse_legacy(conn,cursor.lastrowid,time.time())
                conn.commit()
                return cursor.lastrowid
        except Exception as e:
            logging.error(f"Failed to create database session: {e}")
            return None

    def end_session(self, session_id: int, end_time: float, avg_cei: float) -> None:
        try:
            with self._get_connection() as conn:
                conn.execute("UPDATE legacy_attendance_intervals SET ended_at=last_seen WHERE session_id=? AND ended_at IS NULL",(session_id,))
                conn.execute("UPDATE sessions SET end_time = ?, avg_cei = (SELECT AVG(cei) FROM telemetry WHERE session_id=?), session_status='completed' WHERE session_id = ?",
                             (end_time, session_id, session_id))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to close session {session_id}: {e}")

    def insert_telemetry_batch(self, session_id: int, records: List[Dict[str, Any]]) -> None:
        if not records:
            return
            
        data = [
            (session_id, r["timestamp"], r["cei"], r["attentiveness"], r["distraction"], r["status"], r.get("sample_id") or hashlib.sha256(json.dumps([session_id,r["timestamp"],r["cei"],r["attentiveness"],r["distraction"],r["status"]],sort_keys=True).encode()).hexdigest())
            for r in records
        ]
        
        try:
            with self._get_connection() as conn:
                state=conn.execute("SELECT session_status FROM sessions WHERE session_id=?",(session_id,)).fetchone()
                if not state or state[0] in ('completed','left'):raise ValueError('Session is finalized')
                conn.executemany('''
                    INSERT OR IGNORE INTO telemetry (session_id, timestamp, cei, attentiveness, distraction, status, sample_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', data)
                self._pulse_legacy(conn,session_id,time.time())
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to insert telemetry batch: {e}")
            raise

    def _pulse_legacy(self, conn, session_id, now):
        state=conn.execute("SELECT session_status FROM sessions WHERE session_id=?",(session_id,)).fetchone()
        if not state or state[0] in ('completed','left'):return
        current=conn.execute("SELECT id,last_seen FROM legacy_attendance_intervals WHERE session_id=? AND ended_at IS NULL",(session_id,)).fetchone()
        if current and now-current[1]>30:
            conn.execute("UPDATE legacy_attendance_intervals SET ended_at=last_seen WHERE id=?",(current[0],));current=None
        if current:conn.execute("UPDATE legacy_attendance_intervals SET last_seen=? WHERE id=?",(now,current[0]))
        else:conn.execute("INSERT INTO legacy_attendance_intervals(session_id,started_at,last_seen) VALUES(?,?,?)",(session_id,now,now))
        conn.execute("UPDATE sessions SET last_seen=?,end_time=NULL,avg_cei=NULL,session_status='active' WHERE session_id=?",(now,session_id))

    def touch_session(self, session_id: int) -> None:
        with self._get_connection() as conn:self._pulse_legacy(conn,session_id,time.time())

    def finalize_session(self, session_id: int) -> None:
        """Close using persisted telemetry, including its full-session mean."""
        with self._get_connection() as conn:
            conn.execute("UPDATE legacy_attendance_intervals SET ended_at=last_seen WHERE session_id=? AND ended_at IS NULL",(session_id,))
            conn.execute("""UPDATE sessions SET end_time = COALESCE(
                (SELECT MAX(timestamp) FROM telemetry WHERE session_id = ?), start_time),
                avg_cei = (SELECT AVG(cei) FROM telemetry WHERE session_id = ?),session_status='completed'
                WHERE session_id = ?""", (session_id, session_id, session_id))

    def close_stale_sessions(self, timeout_seconds: float = 30.0) -> None:
        """Recover abandoned sessions after telemetry heartbeats stop."""
        with self._get_connection() as conn:
            conn.execute("""UPDATE sessions SET
                end_time = COALESCE(last_seen, start_time),
                avg_cei = (SELECT AVG(cei) FROM telemetry
                           WHERE telemetry.session_id = sessions.session_id), session_status='stale'
                WHERE session_status='active' AND end_time IS NULL AND COALESCE(last_seen, start_time) < ?""",
                (time.time() - timeout_seconds,))

            conn.execute("""UPDATE legacy_attendance_intervals SET ended_at=last_seen
                WHERE ended_at IS NULL AND session_id IN(SELECT session_id FROM sessions WHERE session_status='stale')""")

    def get_all_sessions(self, room_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves history of recorded sessions, optionally filtered by room_id."""
        try:
            with self._get_connection() as conn:
                if room_id:
                    cursor = conn.execute(
                        "SELECT session_id, room_id, student_name, start_time, end_time, avg_cei, participant_id, session_status FROM sessions WHERE room_id = ? ORDER BY start_time DESC",
                        (room_id,)
                    )
                else:
                    cursor = conn.execute(
                        "SELECT session_id, room_id, student_name, start_time, end_time, avg_cei, participant_id, session_status FROM sessions ORDER BY start_time DESC"
                    )
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logging.error(f"Failed to fetch sessions: {e}")
            return []

    def get_telemetry(self, session_id: int) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.execute('''
                    SELECT timestamp, cei, attentiveness, distraction, status, sample_id
                    FROM telemetry WHERE session_id = ? ORDER BY timestamp ASC
                ''', (session_id,))
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logging.error(f"Failed to fetch telemetry for session {session_id}: {e}")
            return []

    def get_room_session_summary_ledger(self, room_id):
        """Legacy records are preserved; only validated heartbeat intervals earn duration."""
        with self._get_connection() as conn:
            sessions=conn.execute("SELECT session_id,participant_id,student_name,start_time,end_time,last_seen FROM sessions WHERE room_id=? ORDER BY start_time",(room_id,)).fetchall()
            groups={}
            for sid,pid,name,start,end,seen in sessions:
                group=groups.setdefault(pid,{'student_name':name,'participant_id':pid,'scores':[],'intervals':[],'unverified':0,'points':0,'observations':[]})
                records=conn.execute("SELECT timestamp,cei FROM telemetry WHERE session_id=? ORDER BY timestamp",(sid,)).fetchall()
                group['observations'].extend(records)
                group['scores'].extend(score for _,score in records if score is not None)
                group['points']+=len(records)
                intervals=conn.execute("SELECT started_at,COALESCE(ended_at,last_seen) FROM legacy_attendance_intervals WHERE session_id=?",(sid,)).fetchall()
                group['intervals'].extend(intervals)
                if not intervals:group['unverified']+=max(0,(end or seen or start)-start)
                else:group['unverified']+=max(0,min(a for a,b in intervals)-start)
            ledger=[]
            for group in groups.values():
                merged=[]
                for start,end in sorted(group['intervals']):
                    if merged and start<=merged[-1][1]:merged[-1]=(merged[-1][0],max(end,merged[-1][1]))
                    else:merged.append((start,end))
                duration=sum(max(0,b-a) for a,b in merged)
                observed_windows=[]
                for timestamp,score in group['observations']:
                    if score is None:continue
                    for a,b in merged:
                        start,end=max(a,timestamp),min(b,timestamp+5)
                        if end>start:observed_windows.append((start,end))
                coverage=[]
                for a,b in sorted(observed_windows):
                    if coverage and a<=coverage[-1][1]:coverage[-1]=(coverage[-1][0],max(b,coverage[-1][1]))
                    else:coverage.append((a,b))
                observed=sum(b-a for a,b in coverage)
                avg=sum(group['scores'])/len(group['scores']) if group['scores'] else None
                ledger.append({'participant_id':group['participant_id'],'student_name':group['student_name'],
                    'duration_seconds':round(duration,1),'duration_str':f"{int(duration//60)}m {int(duration%60)}s",
                    'observed_seconds':observed,'unobserved_seconds':max(0,duration-observed),'attendance_verified':bool(merged),'historical_unverified_seconds':group['unverified'],
                    'avg_cei_pct':round(avg*100,1) if avg is not None else None,
                    'primary_state':'No Telemetry Recorded' if avg is None else 'Mainly Attentive' if avg>=.8 else 'Moderate Attention' if avg>=.6 else 'Low Engagement',
                    'total_data_points':group['points']})
            return ledger

    def finalize_room(self, room_id):
        """Persist finalization for every legacy participant; later writes cannot reopen it."""
        with self._get_connection() as conn:
            conn.execute("""UPDATE legacy_attendance_intervals SET ended_at=last_seen WHERE ended_at IS NULL
                AND session_id IN(SELECT session_id FROM sessions WHERE room_id=?)""",(room_id,))
            conn.execute("""UPDATE sessions SET end_time=COALESCE(end_time,last_seen,start_time),
                avg_cei=(SELECT AVG(cei) FROM telemetry WHERE telemetry.session_id=sessions.session_id),
                session_status='completed' WHERE room_id=?""",(room_id,))
