"""EduGuard HTTP API; video and facial inference stay in browsers."""
import csv
import hmac
import io
import os
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from pydantic import BaseModel, Field, ConfigDict, model_validator
from sqlalchemy import select, update
from backend.store import Store

load_dotenv('.env.local')


@dataclass
class Settings:
    database_url: str
    signing_key: str
    teacher_password: str
    origins: list[str]
    signaling_url: str

    @classmethod
    def from_env(cls):
        return cls(os.getenv('DATABASE_URL', 'sqlite:///eduguard_api.db'),
                   os.getenv('AUTH_SIGNING_KEY', ''), os.getenv('TEACHER_ADMIN_PASSWORD', ''),
                   [x.strip() for x in os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173').split(',') if x.strip()],
                   os.getenv('SIGNALING_URL', 'http://localhost:9000'))


class CreateRoom(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class JoinRoom(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    client_id: uuid.UUID


class Sample(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='ignore')
    sample_id: uuid.UUID
    timestamp: float | None = Field(default=None, ge=0)
    cei_score: float | None = Field(default=None, ge=0, le=1)
    attentiveness: float | None = Field(default=None, ge=0, le=1)
    distraction: float | None = Field(default=None, ge=0, le=1)
    status: str = Field(default='Attentive', max_length=120)
    is_unknown: bool = False

    @model_validator(mode='after')
    def valid_observation(self):
        if not self.is_unknown and any(x is None for x in (self.cei_score, self.attentiveness, self.distraction)):
            raise ValueError('Valid observations require all scores')
        if self.timestamp is not None and self.timestamp > time.time() + 300:
            raise ValueError('Timestamp is in the future')
        return self


class Batch(BaseModel):
    samples: list[Sample] = Field(min_length=1, max_length=100)


def create_app(settings=None):
    settings = settings or Settings.from_env()
    store = None
    signer = URLSafeTimedSerializer(settings.signing_key, salt='eduguard-v1')

    @asynccontextmanager
    async def lifespan(app):
        nonlocal store
        if len(settings.signing_key) < 32:
            raise RuntimeError('Configure AUTH_SIGNING_KEY with at least 32 characters')
        store = Store(settings.database_url)
        app.state.store = store
        yield
        store.engine.dispose()

    app = FastAPI(title='EduGuard API', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins,
                       allow_methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type'])
    bearer = HTTPBearer(auto_error=False)
    attempts = OrderedDict()
    attempt_lock = threading.Lock()

    def authorize(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        try:
            token = signer.loads(credentials.credentials, max_age=43200) if credentials else None
        except (BadSignature, SignatureExpired):
            token = None
        if not token or token.get('room_id') != room_id:
            raise HTTPException(401, 'Invalid or expired classroom session')
        return token

    def teacher(room_id: str, token=Depends(authorize)):
        if token.get('role') != 'teacher':
            raise HTTPException(403, 'Teacher access required')
        return token

    def room_or_404(room_id):
        room = store.room(room_id)
        if not room:
            raise HTTPException(404, 'Classroom not found')
        return room

    @app.get('/health')
    def health():
        with store.engine.connect() as conn:
            conn.execute(select(1))
        return {'status': 'ok'}

    @app.get('/config')
    def config():
        url = urlparse(settings.signaling_url)
        if url.scheme not in ('http', 'https') or not url.hostname:
            raise HTTPException(503, 'Signaling server is not configured')
        return {'signaling': {'host': url.hostname, 'port': url.port or (443 if url.scheme == 'https' else 80),
                               'secure': url.scheme == 'https', 'path': '/eduguard'}}

    @app.post('/rooms', status_code=201)
    def create_room(data: CreateRoom, request: Request):
        address = request.client.host if request.client else 'unknown'
        now = time.time()
        with attempt_lock:
            failures = [t for t in attempts.pop(address, []) if now-t < 60]
            if len(failures) >= 10:
                attempts[address] = failures
                raise HTTPException(429, 'Too many login attempts; try again in a minute')
            failures.append(now)
            attempts[address] = failures
            if len(attempts) > 2048:
                attempts.popitem(last=False)
        if not settings.teacher_password:
            raise HTTPException(503, 'Teacher password is not configured')
        if not hmac.compare_digest(data.password.encode(), settings.teacher_password.encode()):
            raise HTTPException(401, 'Incorrect administrator password')
        name = data.name.strip()
        if not name:
            raise HTTPException(422, 'Classroom name is required')
        room_id = 'EduGuard-' + uuid.uuid4().hex
        with store.engine.begin() as conn:
            conn.execute(store.rooms.insert().values(id=room_id, name=name, closed=False, created_at=now))
        return {'room_id': room_id, 'name': name, 'role': 'teacher',
                'token': signer.dumps({'role': 'teacher', 'room_id': room_id})}

    @app.get('/rooms/{room_id}')
    def room_status(room_id: str):
        return room_or_404(room_id)

    @app.post('/rooms/{room_id}/join')
    def join_room(room_id: str, data: JoinRoom):
        name = data.name.strip()
        if not name:
            raise HTTPException(422, 'Student name is required')
        now = time.time()
        session_id = str(uuid.uuid4())
        with store.engine.begin() as conn:
            room = conn.execute(select(store.rooms).where(store.rooms.c.id == room_id).with_for_update()).mappings().first()
            if not room:
                raise HTTPException(404, 'Classroom not found')
            if room['closed']:
                raise HTTPException(409, 'Classroom has ended')
            # Client IDs label join attempts and never grant access to a session.
            conn.execute(store.sessions.insert().values(id=session_id, room_id=room_id,
                client_id=str(data.client_id), name=name, started_at=now, last_seen=now))
        return {'room_id': room_id, 'name': name, 'role': 'student', 'session_id': session_id,
                'token': signer.dumps({'role': 'student', 'room_id': room_id, 'session_id': session_id})}

    @app.post('/rooms/{room_id}/telemetry')
    def telemetry(room_id: str, data: Batch, token=Depends(authorize)):
        if token.get('role') != 'student':
            raise HTTPException(403, 'Student access required')
        if not store.insert_samples(room_id, token['session_id'], data.samples):
            raise HTTPException(409, 'Classroom has ended')
        return {'accepted': len(data.samples)}

    @app.post('/rooms/{room_id}/leave')
    def leave(room_id: str, token=Depends(authorize)):
        if token.get('role') != 'student':
            raise HTTPException(403, 'Student access required')
        with store.engine.begin() as conn:
            conn.execute(update(store.sessions).where(store.sessions.c.id == token['session_id']).values(ended_at=time.time()))
        return {'ok': True}

    @app.get('/rooms/{room_id}/roster')
    def roster(room_id: str, token=Depends(teacher)):
        return {'room': room_or_404(room_id), 'students': store.roster(room_id)}

    @app.post('/rooms/{room_id}/close')
    def close_room(room_id: str, token=Depends(teacher)):
        with store.engine.begin() as conn:
            conn.execute(select(store.rooms).where(store.rooms.c.id == room_id).with_for_update())
            conn.execute(update(store.rooms).where(store.rooms.c.id == room_id).values(closed=True))
            conn.execute(update(store.sessions).where(store.sessions.c.room_id == room_id,
                         store.sessions.c.ended_at.is_(None)).values(ended_at=time.time()))
        return {'ok': True}

    @app.get('/rooms/{room_id}/report.csv')
    def report(room_id: str, token=Depends(teacher)):
        output = io.StringIO()
        fields = ['session_id', 'student_name', 'timestamp', 'cei', 'attentiveness', 'distraction', 'status', 'is_unknown']
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        with store.engine.connect() as conn:
            query = select(store.samples, store.sessions.c.name).join(store.sessions).where(store.sessions.c.room_id == room_id).order_by(store.samples.c.timestamp)
            for row in conn.execute(query).mappings():
                record = {key: row[key] for key in fields if key != 'student_name'}
                # Prevent spreadsheet formula execution from user-controlled text.
                record['student_name'] = ("'" if row['name'].lstrip().startswith(('=', '+', '-', '@')) else '') + row['name']
                record['status'] = ("'" if row['status'].lstrip().startswith(('=', '+', '-', '@')) else '') + row['status']
                writer.writerow(record)
        return Response(output.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="eduguard-telemetry.csv"'})

    return app


app = create_app()
