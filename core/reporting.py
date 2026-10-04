"""
Reporting & Export Module
=========================
Purpose:
Generates post-lecture reports and CSV payloads from local SQLite database records.
"""

import pandas as pd
from typing import Optional
import logging

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from core.db_manager import DatabaseManager

def generate_csv_report(db: DatabaseManager, session_id: int) -> Optional[str]:
    try:
        telemetry = db.get_telemetry(session_id)
        if not telemetry:
            logging.warning(f"No telemetry data found for Session {session_id}.")
            return None
            
        df = pd.DataFrame(telemetry)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='s')
        
        df['cei_percent'] = (df['cei'] * 100).round(1).astype(str) + '%'
        df['attentiveness_percent'] = (df['attentiveness'] * 100).round(1).astype(str) + '%'
        df['distraction_percent'] = (df['distraction'] * 100).round(1).astype(str) + '%'
        
        csv_buffer = df.to_csv(index=False)
        return csv_buffer
        
    except Exception as e:
        logging.error(f"Failed to generate CSV report for Session {session_id}: {e}")
        return None
