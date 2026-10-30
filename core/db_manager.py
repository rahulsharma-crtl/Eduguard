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
            conn.execute("PRAGMA synchronous=NORMAL")
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
                if "last_seen" not in {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}:
                    conn.execute("ALTER TABLE sessions ADD COLUMN last_seen REAL")
                    conn.execute("UPDATE sessions SET last_seen = COALESCE((SELECT MAX(timestamp) FROM telemetry WHERE telemetry.session_id = sessions.session_id), start_time)")
                if "sample_id" not in {row[1] for row in conn.execute("PRAGMA table_info(telemetry)")}:
                    conn.execute("ALTER TABLE telemetry ADD COLUMN sample_id TEXT")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_sample_id ON telemetry(session_id, sample_id) WHERE sample_id IS NOT NULL")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_session_id ON telemetry(session_id)")
                conn.commit()
            logging.info("SQLite Database initialized successfully.")
        except Exception as e:
            logging.error(f"Failed to initialize SQLite schemas: {e}")

    def create_session(self, room_id: str, student_name: str, start_time: float) -> Optional[int]:
        """Registers a new student session under a specific classroom room_id."""
        try:
            with self._get_connection() as conn:
                cursor = conn.execute(
                    "INSERT INTO sessions (room_id, student_name, start_time, last_seen) VALUES (?, ?, ?, ?)",
                    (room_id, student_name, start_time, start_time)
                )
                conn.commit()
                return cursor.lastrowid
        except Exception as e:
            logging.error(f"Failed to create database session: {e}")
            return None

    def end_session(self, session_id: int, end_time: float, avg_cei: float) -> None:
        try:
            with self._get_connection() as conn:
                conn.execute("UPDATE sessions SET end_time = ?, avg_cei = ? WHERE session_id = ?",
                             (end_time, avg_cei, session_id))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to close session {session_id}: {e}")

    def insert_telemetry_batch(self, session_id: int, records: List[Dict[str, Any]]) -> None:
        if not records:
            return
            
        data = [
            (session_id, r["timestamp"], r["cei"], r["attentiveness"], r["distraction"], r["status"], r.get("sample_id"))
            for r in records
        ]
        
        try:
            with self._get_connection() as conn:
                conn.executemany('''
                    INSERT OR IGNORE INTO telemetry (session_id, timestamp, cei, attentiveness, distraction, status, sample_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', data)
                conn.execute("UPDATE sessions SET last_seen = ?, end_time = NULL, avg_cei = NULL WHERE session_id = ?", (max(r["timestamp"] for r in records), session_id))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to insert telemetry batch: {e}")
            raise

    def touch_session(self, session_id: int) -> None:
        with self._get_connection() as conn:
            conn.execute("UPDATE sessions SET last_seen = ?, end_time = NULL, avg_cei = NULL WHERE session_id = ?", (time.time(), session_id))

    def finalize_session(self, session_id: int) -> None:
        """Close using persisted telemetry, including its full-session mean."""
        with self._get_connection() as conn:
            conn.execute("""UPDATE sessions SET end_time = COALESCE(
                (SELECT MAX(timestamp) FROM telemetry WHERE session_id = ?), start_time),
                avg_cei = (SELECT AVG(cei) FROM telemetry WHERE session_id = ?)
                WHERE session_id = ?""", (session_id, session_id, session_id))

    def close_stale_sessions(self, timeout_seconds: float = 30.0) -> None:
        """Recover abandoned sessions after telemetry heartbeats stop."""
        with self._get_connection() as conn:
            conn.execute("""UPDATE sessions SET
                end_time = COALESCE((SELECT MAX(timestamp) FROM telemetry
                                    WHERE telemetry.session_id = sessions.session_id), start_time),
                avg_cei = (SELECT AVG(cei) FROM telemetry
                           WHERE telemetry.session_id = sessions.session_id)
                WHERE end_time IS NULL AND COALESCE(last_seen, start_time) < ?""",
                (time.time() - timeout_seconds,))

    def get_all_sessions(self, room_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves history of recorded sessions, optionally filtered by room_id."""
        try:
            with self._get_connection() as conn:
                if room_id:
                    cursor = conn.execute(
                        "SELECT session_id, room_id, student_name, start_time, end_time, avg_cei FROM sessions WHERE room_id = ? ORDER BY start_time DESC",
                        (room_id,)
                    )
                else:
                    cursor = conn.execute(
                        "SELECT session_id, room_id, student_name, start_time, end_time, avg_cei FROM sessions ORDER BY start_time DESC"
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
                    SELECT timestamp, cei, attentiveness, distraction, status 
                    FROM telemetry WHERE session_id = ? ORDER BY timestamp ASC
                ''', (session_id,))
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logging.error(f"Failed to fetch telemetry for session {session_id}: {e}")
            return []

    def get_room_session_summary_ledger(self, room_id: str) -> List[Dict[str, Any]]:
        """
        Calculates final engagement aggregation metrics for all students who participated
        in a classroom room_id session.
        Returns a ledger with:
          - student_name
          - duration_str & duration_seconds
          - avg_cei_pct
          - primary_state ("Mainly Attentive", "Frequent Distractions", "High Drowsiness")
          - total_data_points
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.execute(
                    "SELECT session_id, student_name, start_time, end_time, avg_cei FROM sessions WHERE room_id = ? ORDER BY start_time ASC",
                    (room_id,)
                )
                sessions = cursor.fetchall()
                if not sessions:
                    return []

                ledger = []
                student_stats = {}

                for s_id, s_name, start_t, end_t, stored_avg in sessions:
                    t_cursor = conn.execute(
                        "SELECT timestamp, cei, status FROM telemetry WHERE session_id = ? ORDER BY timestamp ASC",
                        (s_id,)
                    )
                    t_records = t_cursor.fetchall()

                    if s_name not in student_stats:
                        student_stats[s_name] = {
                            "session_ids": [s_id],
                            "start_time": start_t,
                            "end_time": end_t if end_t else (t_records[-1][0] if t_records else start_t),
                            "ceis": [],
                            "statuses": []
                        }
                    else:
                        student_stats[s_name]["session_ids"].append(s_id)
                        if end_t and (student_stats[s_name]["end_time"] is None or end_t > student_stats[s_name]["end_time"]):
                            student_stats[s_name]["end_time"] = end_t
                        elif t_records and t_records[-1][0] > student_stats[s_name]["end_time"]:
                            student_stats[s_name]["end_time"] = t_records[-1][0]

                    for _, cei, status in t_records:
                        student_stats[s_name]["ceis"].append(cei)
                        if status:
                            student_stats[s_name]["statuses"].append(status)

                now = time.time()
                for s_name, stats in student_stats.items():
                    start_t = stats["start_time"]
                    end_t = stats["end_time"] if stats["end_time"] else now
                    duration = max(1.0, end_t - start_t)

                    # Average CEI
                    if stats["ceis"]:
                        avg_cei = sum(stats["ceis"]) / len(stats["ceis"])
                    else:
                        avg_cei = 0.0

                    avg_cei_pct = round(avg_cei * 100, 1)

                    # Determine Primary Attention State
                    statuses = stats["statuses"]
                    total_statuses = len(statuses)
                    if total_statuses > 0:
                        evasion_count = sum(1 for s in statuses if ("audio evasion" in s.lower() or s.lower() == "lecture_audio_muted"))
                        drowsy_count = sum(1 for s in statuses if "drowsy" in s.lower())
                        distract_count = sum(1 for s in statuses if ("looking away" in s.lower() or "distract" in s.lower()))
                        absent_count = sum(1 for s in statuses if "absent" in s.lower())

                        evasion_pct = evasion_count / total_statuses
                        drowsy_pct = drowsy_count / total_statuses
                        distract_pct = distract_count / total_statuses
                        absent_pct = absent_count / total_statuses

                        if evasion_pct >= 0.15:
                            primary_state = "Audio Evasion (Silenced Lecture)"
                        elif drowsy_pct >= 0.20:
                            primary_state = "High Drowsiness"
                        elif distract_pct >= 0.25:
                            primary_state = "Frequent Distractions"
                        elif absent_pct >= 0.30:
                            primary_state = "Frequent Absences"
                        elif avg_cei_pct >= 80.0:
                            primary_state = "Mainly Attentive"
                        elif avg_cei_pct >= 60.0:
                            primary_state = "Moderate Attention"
                        else:
                            primary_state = "Low Engagement"
                    else:
                        primary_state = "No Telemetry Recorded"

                    minutes = int(duration // 60)
                    seconds = int(duration % 60)
                    duration_str = f"{minutes}m {seconds}s" if minutes > 0 else f"{seconds}s"

                    ledger.append({
                        "student_name": s_name,
                        "duration_str": duration_str,
                        "duration_seconds": round(duration, 1),
                        "avg_cei_pct": avg_cei_pct,
                        "primary_state": primary_state,
                        "total_data_points": len(stats["ceis"])
                    })

                return ledger
        except Exception as e:
            logging.error(f"Failed to generate session summary ledger: {e}")
            return []
