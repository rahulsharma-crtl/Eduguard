"""
Database Management Module
==========================
Purpose:
Provides local, CPU-optimized, offline-first persistent storage using SQLite.
Stores multi-room session metadata and telemetry for post-lecture analysis.
"""

import sqlite3
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

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

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
                conn.commit()
            logging.info("SQLite Database initialized successfully.")
        except Exception as e:
            logging.error(f"Failed to initialize SQLite schemas: {e}")

    def create_session(self, room_id: str, student_name: str, start_time: float) -> Optional[int]:
        """Registers a new student session under a specific classroom room_id."""
        try:
            with self._get_connection() as conn:
                cursor = conn.execute(
                    "INSERT INTO sessions (room_id, student_name, start_time) VALUES (?, ?, ?)",
                    (room_id, student_name, start_time)
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
            (session_id, r["timestamp"], r["cei"], r["attentiveness"], r["distraction"], r["status"])
            for r in records
        ]
        
        try:
            with self._get_connection() as conn:
                conn.executemany('''
                    INSERT INTO telemetry (session_id, timestamp, cei, attentiveness, distraction, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', data)
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to insert telemetry batch: {e}")

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
