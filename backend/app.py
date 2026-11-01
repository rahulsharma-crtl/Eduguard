"""EduGuard HTTP API; video and facial inference stay in browsers."""
import csv
import hmac
import io
import json
import logging
import os
import threading
import time
import uuid
import secrets
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlparse
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from pydantic import BaseModel, Field, ConfigDict, model_validator
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from backend.passwords import password_hash, verify_password, recovery_hash
import asyncio
from contextlib import suppress
from typing import Literal
from backend.store import Store

load_dotenv('.env.local')


@dataclass
class Settings:
    database_url: str
    signing_key: str
    teacher_password: str
    origins: list[str]
    signaling_url: str
    retention_days: int = 7
    ice_servers_json: str = '[{"urls":"stun:stun.l.google.com:19302"}]'

    @classmethod
    def from_env(cls):
        return cls(os.getenv('DATABASE_URL', 'sqlite:///eduguard_api.db'),
                   os.getenv('AUTH_SIGNING_KEY', ''), os.getenv('TEACHER_ADMIN_PASSWORD', ''),
                   [x.strip() for x in os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173').split(',') if x.strip()],
                   os.getenv('SIGNALING_URL', 'http://localhost:9000'),
                   int(os.getenv('RETENTION_DAYS', '7')),
                   os.getenv('ICE_SERVERS_JSON', '[{"urls":"stun:stun.l.google.com:19302"}]'))


class CreateRoom(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=1, max_length=256)


class TeacherCredentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=3, max_length=64, pattern=r'^[a-zA-Z0-9_.-]+$')
    password: str = Field(min_length=1, max_length=128)


class TeacherRecovery(TeacherCredentials):
    recovery_code: str = Field(min_length=32, max_length=128)


class JoinRoom(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    client_id: uuid.UUID
    invitation: str = Field(min_length=16, max_length=2048)
    consent: Literal[True]
    privacy_mode: Literal["mesh", "telemetry-only"]


class Sample(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
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
        async def purge_loop():
            while True:
                try:
                    await asyncio.to_thread(store.close_stale)
                    await asyncio.to_thread(store.purge, max(1, settings.retention_days))
                except Exception:
                    logging.warning("Retention cleanup failed; retrying without logging record contents")
                await asyncio.sleep(5)
        task = asyncio.create_task(purge_loop())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            store.engine.dispose()

    app = FastAPI(title='EduGuard API', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins,
                       allow_methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type'])
    @app.middleware('http')
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    bearer = HTTPBearer(auto_error=False)
    attempts = OrderedDict()
    attempt_lock = threading.Lock()

    def rate_limit(request, username=''):
        address = request.client.host if request.client else 'unknown'
        keys = ['ip:'+address] + (['user:'+username.lower()] if username else [])
        now = time.time()
        with attempt_lock:
            for key in keys:
                failures = [t for t in attempts.get(key, []) if now-t < 60]
                if len(failures) >= 10:
                    raise HTTPException(429, 'Too many login attempts; try again in a minute')
            for key in keys:
                failures = [t for t in attempts.pop(key, []) if now-t < 60]
                attempts[key] = failures + [now]
            while len(attempts) > 2048:
                attempts.popitem(last=False)

    def account(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        try:
            token = signer.loads(credentials.credentials, max_age=43200) if credentials else None
        except (BadSignature, SignatureExpired):
            token = None
        if not token or token.get('role') != 'teacher-account':
            raise HTTPException(401, 'Sign in to your teacher account')
        with store.engine.connect() as conn:
            row = conn.execute(select(store.teachers).where(store.teachers.c.id == token.get('teacher_id'))).mappings().first()
        if not row or row['auth_version'] != token.get('version'):
            raise HTTPException(401, 'Teacher sign-in expired; sign in again')
        return dict(row)

    def account_result(row, recovery_code=None):
        result = {'username':row['username'], 'account_token':signer.dumps({'role':'teacher-account','teacher_id':row['id'],'version':row['auth_version']}), 'expires_at':time.time()+43200}
        if recovery_code is not None:
            result['recovery_code'] = recovery_code
        return result

    def password_policy(password):
        if len(password) < 6 or password.lower() in {'passwordpassword', '123456789012345', 'qwertyuiopasdfgh'}:
            raise HTTPException(422, 'Choose a unique password or passphrase of 6–128 characters')

    @app.post('/teachers/register', status_code=201)
    def register_teacher(data: TeacherCredentials, request: Request):
        rate_limit(request, data.username)
        password_policy(data.password)
        code = secrets.token_urlsafe(32)
        row = {'id':str(uuid.uuid4()), 'username':data.username.lower(), 'password_hash':password_hash(data.password), 'recovery_hash':recovery_hash(code), 'auth_version':str(uuid.uuid4()), 'created_at':time.time()}
        try:
            with store.engine.begin() as conn:
                conn.execute(store.teachers.insert().values(**row))
        except IntegrityError:
            raise HTTPException(409, 'That username is unavailable; choose another or sign in')
        return account_result(row, code)

    @app.post('/teachers/login')
    def login_teacher(data: TeacherCredentials, request: Request):
        rate_limit(request, data.username)
        with store.engine.connect() as conn:
            row = conn.execute(select(store.teachers).where(store.teachers.c.username == data.username.lower())).mappings().first()
        if not verify_password(row['password_hash'] if row else None, data.password):
            raise HTTPException(401, 'Incorrect username or password')
        return account_result(row)

    @app.post('/teachers/recover')
    def recover_teacher(data: TeacherRecovery, request: Request):
        rate_limit(request, data.username)
        password_policy(data.password)
        new_code = secrets.token_urlsafe(32)
        version = str(uuid.uuid4())
        encoded = password_hash(data.password)
        with store.engine.begin() as conn:
            row = conn.execute(select(store.teachers).where(store.teachers.c.username == data.username.lower()).with_for_update()).mappings().first()
            if not row or not hmac.compare_digest(row['recovery_hash'], recovery_hash(data.recovery_code)):
                raise HTTPException(401, 'Incorrect username or recovery code')
            changed = conn.execute(update(store.teachers).where(store.teachers.c.id == row['id'], store.teachers.c.recovery_hash == recovery_hash(data.recovery_code)).values(password_hash=encoded, recovery_hash=recovery_hash(new_code), auth_version=version))
            if changed.rowcount != 1:
                raise HTTPException(401, 'Recovery code already used')
        return account_result({**row, 'auth_version':version}, new_code)

    @app.get('/teachers/rooms')
    def owned_rooms(owner=Depends(account)):
        with store.engine.connect() as conn:
            rooms = conn.execute(select(store.rooms.c.id,store.rooms.c.name,store.rooms.c.closed).where(store.rooms.c.owner_id == owner['id']).order_by(store.rooms.c.created_at.desc())).mappings().all()
        return {'rooms':[dict(row) for row in rooms]}

    def authorize(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        try:
            token = signer.loads(credentials.credentials, max_age=43200) if credentials else None
        except (BadSignature, SignatureExpired):
            token = None
        if not token or token.get('role') not in {'teacher','student'} or token.get('room_id') != room_id:
            raise HTTPException(401, 'Invalid or expired classroom session')
        if not store.room(room_id):
            raise HTTPException(401, 'Room deleted or expired')
        if token.get('role') == 'teacher':
            room = store.room(room_id)
            if room.get('owner_id'):
                with store.engine.connect() as conn:
                    owner = conn.execute(select(store.teachers).where(store.teachers.c.id == room['owner_id'])).mappings().first()
                if not owner or token.get('teacher_id') != owner['id'] or token.get('version') != owner['auth_version']:
                    raise HTTPException(401, 'Teacher sign-in changed; reopen this room from your account')
        if token.get('role') == 'student':
            if token.get('consent') is not True:
                raise HTTPException(401, 'Rejoin with explicit monitoring consent')
            with store.engine.connect() as conn:
                if not conn.execute(select(store.sessions.c.id).where(store.sessions.c.id == token.get('session_id'))).first():
                    raise HTTPException(401, 'Session deleted')
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
        try:
            ice_servers = json.loads(settings.ice_servers_json)
            if not isinstance(ice_servers, list) or not ice_servers or any(
                    not isinstance(server, dict) or not server.get('urls') for server in ice_servers):
                raise ValueError('Invalid ICE servers')
        except (ValueError, TypeError):
            raise HTTPException(503, 'ICE_SERVERS_JSON must be a nonempty JSON array of ICE servers')
        return {'retention_days':max(1,settings.retention_days), 'signaling': {'iceServers': ice_servers, 'host': url.hostname, 'port': url.port or (443 if url.scheme == 'https' else 80),
                               'secure': url.scheme == 'https', 'path': '/eduguard'}}

    def teacher_room_result(room_id, name, owner=None):
        claims = {'role':'teacher','room_id':room_id}
        if owner:
            claims.update(teacher_id=owner['id'],version=owner['auth_version'])
        return {'room_id':room_id,'name':name,'role':'teacher',
                'peer_room':hmac.new(settings.signing_key.encode(),room_id.encode(),'sha256').hexdigest(),
                'invitation':signer.dumps({'role':'invitation','room_id':room_id}), 'token':signer.dumps(claims)}

    @app.post('/rooms', status_code=201)
    def create_room(data: CreateRoom, request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        owner = None
        if credentials:
            owner = account(credentials)
        else:
            # Transitional compatibility for old clients; never requires a shared password.
            rate_limit(request)
            legacy_enabled = bool(settings.teacher_password and len(settings.teacher_password)>=12 and settings.teacher_password!='admin123')
            if not legacy_enabled or not data.password or not hmac.compare_digest(data.password.encode(),settings.teacher_password.encode()):
                raise HTTPException(401, 'Incorrect administrator password' if legacy_enabled else 'Sign in to your teacher account')
        name = data.name.strip()
        if not name:
            raise HTTPException(422, 'Classroom name is required')
        room_id = 'EduGuard-' + uuid.uuid4().hex
        with store.engine.begin() as conn:
            conn.execute(store.rooms.insert().values(id=room_id,name=name,closed=False,created_at=time.time(),owner_id=owner['id'] if owner else None))
        return teacher_room_result(room_id,name,owner)

    @app.post('/rooms/{room_id}/teacher-resume')
    def teacher_resume(room_id: str, owner=Depends(account)):
        room = room_or_404(room_id)
        if room.get('owner_id') != owner['id']:
            raise HTTPException(403, 'This classroom belongs to another teacher')
        return {**teacher_room_result(room_id,room['name'],owner),'closed':room['closed']}

    @app.get('/rooms/{room_id}')
    def room_status(room_id: str, token=Depends(authorize)):
        return room_or_404(room_id)

    @app.post('/rooms/{room_id}/join')
    def join_room(room_id: str, data: JoinRoom):
        try:
            invite = signer.loads(data.invitation, max_age=43200)
        except (BadSignature, SignatureExpired):
            raise HTTPException(403, 'Invalid or expired invitation')
        if invite != {'role':'invitation','room_id':room_id}:
            raise HTTPException(403, 'Invitation does not admit this room')
        name = data.name.strip()
        if not name:
            raise HTTPException(422, 'Display alias is required')
        session_id=store.admit(room_id,str(data.client_id),name,data.privacy_mode)
        if not session_id:
            raise HTTPException(409, 'Classroom missing or ended')
        return {'room_id': room_id, 'name': name, 'role': 'student', 'session_id': session_id,
                'privacy_mode': data.privacy_mode, 'server_utc':time.time(),
                'resume_ticket': signer.dumps({'role':'resume','room_id':room_id,'session_id':session_id,'privacy_mode':data.privacy_mode,'consent':True}),
                'peer_room': hmac.new(settings.signing_key.encode(), room_id.encode(), 'sha256').hexdigest(),
                'token': signer.dumps({'role': 'student', 'room_id': room_id, 'session_id': session_id, 'privacy_mode':data.privacy_mode, 'consent':True})}

    class Resume(BaseModel):
        resume_ticket: str = Field(min_length=16,max_length=2048)

    @app.post('/rooms/{room_id}/resume')
    def resume(room_id: str, data: Resume):
        try:
            token=signer.loads(data.resume_ticket,max_age=max(1,settings.retention_days)*86400)
        except (BadSignature,SignatureExpired):
            raise HTTPException(401,'Invalid or expired resume ticket')
        if token.get('role')!='resume' or token.get('room_id')!=room_id or token.get('consent') is not True:
            raise HTTPException(401,'Invalid resume scope')
        if not store.heartbeat(room_id,token['session_id']):
            raise HTTPException(409,'Classroom or participant is no longer resumable')
        token['role']='student'
        return {'token':signer.dumps(token),'server_utc':time.time()}

    @app.post('/rooms/{room_id}/heartbeat')
    def heartbeat(room_id: str, token=Depends(authorize)):
        if token['role']!='student': raise HTTPException(403,'Student required')
        if not store.heartbeat(room_id,token['session_id']): raise HTTPException(409,'Classroom ended')
        return {'status':'active','server_utc':time.time()}

    class Recovery(Batch):
        resume_ticket: str = Field(min_length=16,max_length=2048)

    @app.post('/rooms/{room_id}/recover-telemetry')
    def recover_telemetry(room_id: str, data: Recovery):
        try:
            token=signer.loads(data.resume_ticket,max_age=max(1,settings.retention_days)*86400)
        except (BadSignature,SignatureExpired):
            raise HTTPException(401,'Invalid recovery ticket')
        if token.get('role')!='resume' or token.get('room_id')!=room_id or token.get('consent') is not True:
            raise HTTPException(401,'Invalid recovery scope')
        outcome=store.insert_samples(room_id,token['session_id'],data.samples,recovery=True)
        if outcome is False:raise HTTPException(404,'Session deleted or expired')
        return outcome

    @app.post('/rooms/{room_id}/resume-ticket')
    def resume_ticket(room_id: str, token=Depends(authorize)):
        if token['role']!='student':raise HTTPException(403,'Student required')
        resume={**token,'role':'resume'}
        return {'resume_ticket':signer.dumps(resume)}

    @app.post('/rooms/{room_id}/telemetry')
    def telemetry(room_id: str, data: Batch, token=Depends(authorize)):
        if token.get('role') != 'student':
            raise HTTPException(403, 'Student access required')
        with store.engine.connect() as conn:
            active = conn.execute(select(store.sessions.c.id).where(store.sessions.c.id == token['session_id'], store.sessions.c.ended_at.is_(None))).first()
        if not active:
            raise HTTPException(403, 'Student session ended or deleted')
        if not store.insert_samples(room_id, token['session_id'], data.samples):
            raise HTTPException(409, 'Classroom has ended')
        return {'accepted': len(data.samples)}

    @app.post('/rooms/{room_id}/leave')
    def leave(room_id: str, token=Depends(authorize)):
        if token.get('role') != 'student':
            raise HTTPException(403, 'Student access required')
        store.finish(room_id,token['session_id'])
        return {'ok': True}

    @app.get('/rooms/{room_id}/roster')
    def roster(room_id: str, token=Depends(teacher)):
        return {'room': room_or_404(room_id), 'students': store.roster(room_id)}

    @app.post('/rooms/{room_id}/close')
    def close_room(room_id: str, token=Depends(teacher)):
        store.finish(room_id)
        return {'ok': True}

    @app.post('/rooms/{room_id}/delete-data')
    def delete_data(room_id: str, token=Depends(authorize)):
        store.erase(room_id, token.get('session_id') if token['role']=='student' else None)
        return {'ok': True}

    @app.get('/rooms/{room_id}/report.csv')
    def report(room_id: str, token=Depends(teacher)):
        output = io.StringIO()
        fields = ['session_id', 'sample_id', 'student_name', 'timestamp', 'timestamp_utc', 'received_at_utc', 'cei', 'attentiveness', 'distraction', 'status', 'is_unknown','session_status','validated_presence_seconds','observed_seconds','unobserved_seconds','disconnected_seconds']
        summaries={row['id']:row for row in store.roster(room_id)}
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        with store.engine.connect() as conn:
            query = select(store.samples, store.sessions.c.name).join(store.sessions).where(store.sessions.c.room_id == room_id).order_by(store.samples.c.timestamp)
            for row in conn.execute(query).mappings():
                record = {key: row[key] for key in ['session_id','sample_id','timestamp','cei','attentiveness','distraction','status','is_unknown']}
                record['timestamp_utc']=datetime.fromtimestamp(row['timestamp'],timezone.utc).isoformat()
                record['received_at_utc']=datetime.fromtimestamp(row['received_at'],timezone.utc).isoformat() if row['received_at'] is not None else ''
                summary=summaries[row['session_id']]
                record.update(session_status=summary['status'],validated_presence_seconds=summary['duration_seconds'],observed_seconds=summary['observed_seconds'],unobserved_seconds=summary['unobserved_seconds'],disconnected_seconds=summary['disconnected_seconds'])
                # Prevent spreadsheet formula execution from user-controlled text.
                record['student_name'] = ("'" if row['name'].lstrip().startswith(('=', '+', '-', '@')) else '') + row['name']
                record['status'] = ("'" if row['status'].lstrip().startswith(('=', '+', '-', '@')) else '') + row['status']
                writer.writerow(record)
        return Response(output.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="eduguard-telemetry.csv"'})

    return app


app = create_app()
