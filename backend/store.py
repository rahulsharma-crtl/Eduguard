"""Transactional classroom storage, supporting PostgreSQL and local SQLite."""
import time
from sqlalchemy import (create_engine, MetaData, Table, Column, String, Float, Boolean,
                        ForeignKey, Index, select, update, func, case, delete, inspect, text, event)


class Store:
    def __init__(self, url):
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        self.engine = create_engine(url, pool_pre_ping=True,
            connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
        if url.startswith('sqlite'):
            @event.listens_for(self.engine, 'connect')
            def enable_foreign_keys(connection, _):
                connection.execute('PRAGMA foreign_keys=ON')
        self.meta = MetaData()
        self.rooms = Table("classrooms", self.meta,
            Column("id", String(80), primary_key=True), Column("name", String(100), nullable=False),
            Column("closed", Boolean, nullable=False, default=False), Column("created_at", Float, nullable=False))
        self.sessions = Table("classroom_sessions", self.meta,
            Column("id", String(36), primary_key=True),
            Column("room_id", String(80), ForeignKey("classrooms.id"), nullable=False, index=True),
            Column("client_id", String(36), nullable=False), Column("name", String(100), nullable=False),
            Column("started_at", Float, nullable=False), Column("last_seen", Float, nullable=False),
            Column("ended_at", Float), Column("privacy_mode", String(20)), Column("consent_at", Float))
        self.samples = Table("classroom_samples", self.meta,
            Column("session_id", String(36), ForeignKey("classroom_sessions.id"), primary_key=True),
            Column("sample_id", String(36), primary_key=True), Column("timestamp", Float, nullable=False),
            Column("cei", Float), Column("attentiveness", Float), Column("distraction", Float),
            Column("status", String(120), nullable=False), Column("is_unknown", Boolean, nullable=False))
        Index("idx_classroom_samples_session_timestamp", self.samples.c.session_id, self.samples.c.timestamp)
        self.meta.create_all(self.engine)
        existing = {column['name'] for column in inspect(self.engine).get_columns('classroom_sessions')}
        with self.engine.begin() as conn:
            for name, sql_type in [('privacy_mode','VARCHAR(20)'), ('consent_at','FLOAT')]:
                if name not in existing:
                    conn.execute(text(f'ALTER TABLE classroom_sessions ADD COLUMN {name} {sql_type}'))

    def room(self, room_id):
        with self.engine.connect() as conn:
            row = conn.execute(select(self.rooms).where(self.rooms.c.id == room_id)).mappings().first()
            return dict(row) if row else None

    def roster(self, room_id):
        # A fixed number of reads avoids one network round trip per student.
        with self.engine.connect() as conn:
            rows = conn.execute(select(self.sessions).where(self.sessions.c.room_id == room_id)
                                .order_by(self.sessions.c.started_at)).mappings().all()
            if not rows:
                return []
            ids = [row["id"] for row in rows]
            counts = conn.execute(select(self.samples.c.session_id,
                func.avg(self.samples.c.cei).label("average"),
                func.count(self.samples.c.sample_id).label("total"),
                func.count(self.samples.c.cei).label("valid"),
                func.sum(case((self.samples.c.status == "Drowsy (Eyes Closed)", 1), else_=0)).label("drowsy"),
                func.sum(case((self.samples.c.status.in_(["Looking Away", "Looking Up"]), 1), else_=0)).label("away"),
                func.sum(case((self.samples.c.status == "Subject Absent", 1), else_=0)).label("absent"))
                .where(self.samples.c.session_id.in_(ids)).group_by(self.samples.c.session_id)).mappings().all()
            stats_by_session = {row["session_id"]: row for row in counts}
            ranked = (select(self.samples, func.row_number().over(
                partition_by=self.samples.c.session_id,
                order_by=self.samples.c.timestamp.desc()).label("position"))
                .where(self.samples.c.session_id.in_(ids)).subquery())
            latest_by_session = {row["session_id"]: dict(row) for row in conn.execute(
                select(ranked).where(ranked.c.position == 1)).mappings()}
            result = []
            now = time.time()
            for original in rows:
                row = dict(original)
                row.pop("client_id", None)
                stats = stats_by_session.get(row["id"], {})
                average = stats.get("average")
                valid = stats.get("valid", 0)
                if not valid:
                    state = "No Scored Observations"
                elif stats["drowsy"] / valid >= .20:
                    state = "High Drowsiness"
                elif stats["away"] / valid >= .25:
                    state = "Frequent Distractions"
                elif stats["absent"] / valid >= .30:
                    state = "Frequent Absences"
                else:
                    state = "Mainly Attentive" if average >= .8 else "Moderate Attention" if average >= .6 else "Low Engagement"
                online = row["ended_at"] is None and now - row["last_seen"] < 30
                end = row["ended_at"] or (now if online else row["last_seen"])
                row.update(avg_cei=average, total_samples=stats.get("total", 0),
                           online=online, duration_seconds=max(0, end-row["started_at"]), primary_state=state,
                           latest=latest_by_session.get(row["id"]))
                result.append(row)
            return result

    def insert_samples(self, room_id, session_id, records):
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        with self.engine.begin() as conn:
            # Serialize room closure against sample ingestion.
            room = conn.execute(select(self.rooms).where(self.rooms.c.id == room_id).with_for_update()).mappings().first()
            if not room or room["closed"]:
                return False
            session = conn.execute(select(self.sessions.c.id).where(
                self.sessions.c.id == session_id, self.sessions.c.room_id == room_id,
                self.sessions.c.ended_at.is_(None)).with_for_update()).first()
            if not session:
                return False
            now = time.time()
            values = [{"session_id": session_id, "sample_id": str(record.sample_id),
                "timestamp": record.timestamp or now, "cei": None if record.is_unknown else record.cei_score,
                "attentiveness": None if record.is_unknown else record.attentiveness,
                "distraction": None if record.is_unknown else record.distraction,
                "status": "Observation Insufficient" if record.is_unknown else record.status,
                "is_unknown": record.is_unknown} for record in records]
            insert = sqlite_insert if self.engine.dialect.name == "sqlite" else pg_insert
            conn.execute(insert(self.samples).values(values).on_conflict_do_nothing())
            conn.execute(update(self.sessions).where(self.sessions.c.id == session_id)
                         .values(last_seen=now, ended_at=None))
            return True

    def erase(self, room_id, session_id=None):
        with self.engine.begin() as conn:
            conn.execute(select(self.rooms.c.id).where(self.rooms.c.id == room_id).with_for_update()).first()
            ids = select(self.sessions.c.id).where(self.sessions.c.room_id == room_id)
            if session_id:
                ids = ids.where(self.sessions.c.id == session_id)
            conn.execute(delete(self.samples).where(self.samples.c.session_id.in_(ids)))
            query = delete(self.sessions).where(self.sessions.c.room_id == room_id)
            if session_id:
                query = query.where(self.sessions.c.id == session_id)
            conn.execute(query)
            if not session_id:
                conn.execute(delete(self.rooms).where(self.rooms.c.id == room_id))

    def purge(self, days):
        with self.engine.connect() as conn:
            ids = conn.execute(select(self.rooms.c.id).where(self.rooms.c.created_at < time.time()-days*86400)).scalars().all()
        for room in ids:
            self.erase(room)
