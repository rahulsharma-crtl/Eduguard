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
                connection.execute('PRAGMA journal_mode=WAL')
                connection.execute('PRAGMA synchronous=FULL')
                connection.execute('PRAGMA busy_timeout=20000')
        self.meta = MetaData()
        self.rooms = Table("classrooms", self.meta,
            Column("id", String(80), primary_key=True), Column("name", String(100), nullable=False),
            Column("closed", Boolean, nullable=False, default=False), Column("created_at", Float, nullable=False), Column("ended_at", Float))
        self.sessions = Table("classroom_sessions", self.meta,
            Column("id", String(36), primary_key=True),
            Column("room_id", String(80), ForeignKey("classrooms.id"), nullable=False, index=True),
            Column("client_id", String(36), nullable=False), Column("name", String(100), nullable=False),
            Column("started_at", Float, nullable=False), Column("last_seen", Float, nullable=False),
            Column("ended_at", Float), Column("status", String(20), default="active"), Column("privacy_mode", String(20)), Column("consent_at", Float))
        self.samples = Table("classroom_samples", self.meta,
            Column("session_id", String(36), ForeignKey("classroom_sessions.id"), primary_key=True),
            Column("sample_id", String(36), primary_key=True), Column("timestamp", Float, nullable=False), Column("received_at", Float),
            Column("cei", Float), Column("attentiveness", Float), Column("distraction", Float),
            Column("status", String(120), nullable=False), Column("is_unknown", Boolean, nullable=False))
        Index("idx_classroom_samples_session_timestamp", self.samples.c.session_id, self.samples.c.timestamp)
        self.intervals = Table('classroom_attendance_intervals', self.meta,
            Column('id', String(36), primary_key=True), Column('session_id', String(36), ForeignKey('classroom_sessions.id'), nullable=False, index=True),
            Column('started_at', Float, nullable=False), Column('last_seen', Float, nullable=False), Column('ended_at', Float))
        self.admissions = Table('classroom_admissions', self.meta,
            Column('room_id', String(80), ForeignKey('classrooms.id'), primary_key=True),
            Column('client_id', String(36), primary_key=True), Column('session_id', String(36), ForeignKey('classroom_sessions.id'), nullable=False))
        self.migrations = Table('eduguard_schema_migrations', self.meta, Column('version', String(20), primary_key=True), Column('applied_at', Float, nullable=False))
        self.meta.create_all(self.engine)
        self.migrate()
        Index('idx_classroom_sessions_status_seen', self.sessions.c.status, self.sessions.c.last_seen).create(self.engine, checkfirst=True)
        Index('idx_classroom_rooms_created', self.rooms.c.created_at).create(self.engine, checkfirst=True)

    def migrate(self):
        # Additive migrations only: no old rows, timestamps, or telemetry are rewritten.
        additions = {'classrooms': [('ended_at','FLOAT')],
            'classroom_sessions': [('privacy_mode','VARCHAR(20)'),('consent_at','FLOAT'),('status','VARCHAR(20)')],
            'classroom_samples': [('received_at','FLOAT')]}
        with self.engine.begin() as conn:
            for table, columns in additions.items():
                existing = {c['name'] for c in inspect(conn).get_columns(table)}
                for name, sql_type in columns:
                    if name not in existing:
                        conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {sql_type}'))
            conn.execute(text("UPDATE classroom_sessions SET status = CASE WHEN ended_at IS NULL THEN 'stale' ELSE 'completed' END WHERE status IS NULL"))
            if not conn.execute(select(self.migrations.c.version).where(self.migrations.c.version=='2')).first():
                conn.execute(self.migrations.insert().values(version='2',applied_at=time.time()))

    def room(self, room_id):
        with self.engine.connect() as conn:
            row = conn.execute(select(self.rooms).where(self.rooms.c.id == room_id)).mappings().first()
            if not row:return None
            from datetime import datetime, timezone
            value=dict(row);value['status']='completed' if value['closed'] else 'active'
            for field in ['created_at','ended_at']:
                value[field+'_utc']=datetime.fromtimestamp(value[field],timezone.utc).isoformat() if value[field] is not None else None
            return value

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
            intervals_by_session={}
            for row in conn.execute(select(self.intervals).where(self.intervals.c.session_id.in_(ids))).mappings():
                intervals_by_session.setdefault(row['session_id'],[]).append(row)
            sample_windows={}
            for sid,timestamp,score,received in conn.execute(select(self.samples.c.session_id,self.samples.c.timestamp,self.samples.c.cei,self.samples.c.received_at).where(self.samples.c.session_id.in_(ids))):
                sample_windows.setdefault(sid,[]).append((timestamp,score,received))
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
                online = row['status']=='active' and now-row['last_seen']<30
                participant_intervals=intervals_by_session.get(row['id'],[])
                duration,observed,verified=self.attendance(conn,row['id'],participant_intervals,sample_windows.get(row['id'],[]))
                bounds=sorted((r['started_at'],r['ended_at'] if r['ended_at'] is not None else r['last_seen']) for r in participant_intervals)
                disconnected=sum(max(0,bounds[i][0]-bounds[i-1][1]) for i in range(1,len(bounds)))
                unverified_prefix=max(0,bounds[0][0]-row['started_at']) if bounds else max(0,(row['ended_at'] or row['last_seen'])-row['started_at'])
                end = row["ended_at"] or (now if online else row["last_seen"])
                row.update(avg_cei=average, total_samples=stats.get("total", 0),
                           online=online, duration_seconds=duration, observed_seconds=observed, unobserved_seconds=max(0,duration-observed), attendance_verified=verified, disconnected_seconds=disconnected, historical_unverified_seconds=unverified_prefix,
                           historical_span_seconds=max(0,end-row["started_at"]) if not verified else None, primary_state=state,
                           latest=latest_by_session.get(row["id"]))
                from datetime import datetime, timezone
                for field in ['started_at','last_seen','ended_at']:
                    row[field+'_utc']=datetime.fromtimestamp(row[field],timezone.utc).isoformat() if row[field] is not None else None
                result.append(row)
            return result

    def insert_samples(self, room_id, session_id, records, recovery=False):
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        with self.engine.begin() as conn:
            # Serialize room closure against sample ingestion.
            room = self._lock_room(conn,room_id)
            if not room or (room["closed"] and not recovery):
                return False
            query=select(self.sessions).where(self.sessions.c.id==session_id,self.sessions.c.room_id==room_id)
            if not recovery:query=query.where(self.sessions.c.ended_at.is_(None))
            session=conn.execute(query.with_for_update()).mappings().first()
            if not session:
                return False
            now = time.time()
            rejected=[]
            if recovery:
                cutoff=min(value for value in [now,room['ended_at'],session['ended_at']] if value is not None)
                rejected=[str(record.sample_id) for record in records if record.timestamp is None or record.timestamp<session['started_at'] or record.timestamp>cutoff]
                records=[record for record in records if str(record.sample_id) not in rejected]
            values = [{"session_id": session_id, "sample_id": str(record.sample_id),
                "timestamp": record.timestamp or now, "received_at": now, "cei": None if record.is_unknown else record.cei_score,
                "attentiveness": None if record.is_unknown else record.attentiveness,
                "distraction": None if record.is_unknown else record.distraction,
                "status": "Observation Insufficient" if record.is_unknown else record.status,
                "is_unknown": record.is_unknown} for record in records]
            insert = sqlite_insert if self.engine.dialect.name == "sqlite" else pg_insert
            if values:conn.execute(insert(self.samples).values(values).on_conflict_do_nothing())

            return {'rejected_event_ids':rejected} if recovery else True

    def erase(self, room_id, session_id=None):
        with self.engine.begin() as conn:
            self._lock_room(conn,room_id)
            ids = select(self.sessions.c.id).where(self.sessions.c.room_id == room_id)
            if session_id:
                ids = ids.where(self.sessions.c.id == session_id)
            conn.execute(delete(self.samples).where(self.samples.c.session_id.in_(ids)))
            conn.execute(delete(self.intervals).where(self.intervals.c.session_id.in_(ids)))
            conn.execute(delete(self.admissions).where(self.admissions.c.session_id.in_(ids)))
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

    def _lock_room(self, conn, room_id):
        # UPDATE obtains a write lock on SQLite too (SELECT FOR UPDATE is ignored there).
        conn.execute(update(self.rooms).where(self.rooms.c.id==room_id).values(id=room_id))
        return conn.execute(select(self.rooms).where(self.rooms.c.id==room_id)).mappings().first()

    def _pulse(self, conn, session_id, now):
        import uuid
        current=conn.execute(select(self.intervals).where(self.intervals.c.session_id==session_id,
                    self.intervals.c.ended_at.is_(None))).mappings().first()
        if current and now-current['last_seen']>30:
            conn.execute(update(self.intervals).where(self.intervals.c.id==current['id']).values(ended_at=current['last_seen']))
            current=None
        if current:
            conn.execute(update(self.intervals).where(self.intervals.c.id==current['id']).values(last_seen=now))
        else:
            conn.execute(self.intervals.insert().values(id=str(uuid.uuid4()),session_id=session_id,started_at=now,last_seen=now))
        conn.execute(update(self.sessions).where(self.sessions.c.id==session_id).values(last_seen=now,ended_at=None,status='active'))

    def admit(self, room_id, client_id, name, mode):
        import uuid
        now=time.time()
        with self.engine.begin() as conn:
            room=self._lock_room(conn,room_id)
            if not room or room['closed']: return None
            previous=conn.execute(select(self.admissions.c.session_id).where(self.admissions.c.room_id==room_id,self.admissions.c.client_id==client_id)).scalar()
            if previous:
                conn.execute(update(self.sessions).where(self.sessions.c.id==previous).values(name=name,privacy_mode=mode,consent_at=now))
                self._pulse(conn,previous,now)
                return previous
            session_id=str(uuid.uuid4())
            conn.execute(self.sessions.insert().values(id=session_id,room_id=room_id,client_id=client_id,name=name,
                started_at=now,last_seen=now,status='active',consent_at=now,privacy_mode=mode))
            conn.execute(self.admissions.insert().values(room_id=room_id,client_id=client_id,session_id=session_id))
            self._pulse(conn,session_id,now)
            return session_id

    def heartbeat(self, room_id, session_id):
        with self.engine.begin() as conn:
            room=self._lock_room(conn,room_id)
            row=conn.execute(select(self.sessions).where(self.sessions.c.id==session_id,self.sessions.c.room_id==room_id)).mappings().first()
            if not room or room['closed'] or not row or row['status']=='completed':return False
            self._pulse(conn,session_id,time.time())
            return True

    def finish(self, room_id, session_id=None):
        now=time.time()
        with self.engine.begin() as conn:
            room=self._lock_room(conn,room_id)
            if not room:return
            condition=self.sessions.c.room_id==room_id
            if session_id:condition=condition & (self.sessions.c.id==session_id)
            rows=conn.execute(select(self.sessions).where(condition)).mappings().all()
            for row in rows:
                conn.execute(update(self.intervals).where(self.intervals.c.session_id==row['id'],self.intervals.c.ended_at.is_(None))
                    .values(ended_at=self.intervals.c.last_seen))
                conn.execute(update(self.sessions).where(self.sessions.c.id==row['id'])
                    .values(status='left' if session_id else 'completed',ended_at=row['ended_at'] if row['status'] in ('left','completed') else now))
            if not session_id:
                conn.execute(update(self.rooms).where(self.rooms.c.id==room_id).values(closed=True,ended_at=room['ended_at'] or now))

    def close_stale(self, now=None):
        now=now or time.time()
        with self.engine.connect() as conn:
            rows=conn.execute(select(self.sessions).where(self.sessions.c.status=='active',self.sessions.c.last_seen<now-30)).mappings().all()
        for row in rows:
            with self.engine.begin() as conn:
                self._lock_room(conn,row['room_id'])
                fresh=conn.execute(select(self.sessions).where(self.sessions.c.id==row['id'])).mappings().first()
                if not fresh or fresh['status']!='active' or fresh['last_seen']>=now-30:continue
                conn.execute(update(self.intervals).where(self.intervals.c.session_id==row['id'],self.intervals.c.ended_at.is_(None)).values(ended_at=self.intervals.c.last_seen))
                conn.execute(update(self.sessions).where(self.sessions.c.id==row['id']).values(status='stale',ended_at=fresh['last_seen']))

    def attendance(self, conn, session_id, interval_rows=None, sample_rows=None):
        intervals=interval_rows if interval_rows is not None else conn.execute(select(self.intervals).where(self.intervals.c.session_id==session_id).order_by(self.intervals.c.started_at)).mappings().all()
        candidates=sorted((r['started_at'],r['ended_at'] if r['ended_at'] is not None else r['last_seen']) for r in intervals)
        windows=[]
        for a,b in candidates:
            if b<a:continue
            if windows and a<=windows[-1][1]:windows[-1]=(windows[-1][0],max(b,windows[-1][1]))
            else:windows.append((a,b))
        duration=sum(max(0,b-a) for a,b in windows)
        samples=sample_rows if sample_rows is not None else conn.execute(select(self.samples.c.timestamp,self.samples.c.cei,self.samples.c.received_at).where(self.samples.c.session_id==session_id).order_by(self.samples.c.timestamp)).all()
        observed=[]
        for timestamp,score,received in samples:
            if score is None or received is None:continue
            for a,b in windows:
                start,end=max(a,timestamp),min(b,timestamp+5)
                if end>start:observed.append((start,end))
        merged=[]
        for a,b in sorted(observed):
            if merged and a<=merged[-1][1]:merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
            else:merged.append((a,b))
        seconds=sum(b-a for a,b in merged)
        return duration,seconds,len(windows)>0
