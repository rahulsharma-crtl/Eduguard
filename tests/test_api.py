import time
import uuid
import pytest
from fastapi.testclient import TestClient
from backend.app import Settings, create_app


@pytest.fixture
def client(tmp_path):
    settings = Settings(f"sqlite:///{tmp_path / 'api.db'}", 's' * 48,
                        'private-test-password', ['https://class.example'], 'https://signal.example')
    with TestClient(create_app(settings)) as api:
        yield api


def create_room(client, name='Math'):
    response = client.post('/rooms', json={'name': name, 'password': 'private-test-password'})
    assert response.status_code == 201, response.text
    return response.json()


def join(client, room, name='Alice'):
    response = client.post(f"/rooms/{room['room_id']}/join", json={'name': name, 'client_id': str(uuid.uuid4()), 'invitation':room['invitation'], 'consent':True, 'privacy_mode':'telemetry-only'})
    assert response.status_code == 200
    return response.json()


def auth(session):
    return {'Authorization': f"Bearer {session['token']}"}


def sample(**overrides):
    return dict(sample_id=str(uuid.uuid4()), timestamp=time.time(), cei_score=1,
                attentiveness=1, distraction=0, status='Mic Muted', **overrides)


def test_full_classroom_lifecycle_and_idempotent_telemetry(client):
    teacher = create_room(client)
    student = join(client, teacher)
    path = f"/rooms/{teacher['room_id']}"
    payload = {'samples': [sample()]}
    for _ in range(2):
        assert client.post(path+'/telemetry', json=payload, headers=auth(student)).status_code == 200
    roster = client.get(path+'/roster', headers=auth(teacher)).json()['students']
    assert len(roster) == 1
    assert roster[0]['avg_cei'] == 1
    assert roster[0]['total_samples'] == 1
    assert roster[0]['online'] is True
    response = client.get(path+'/report.csv', headers=auth(teacher))
    assert response.status_code == 200
    assert 'Alice' in response.text and 'Mic Muted' in response.text
    assert client.post(path+'/close',json={},headers=auth(teacher)).status_code == 200
    assert client.get(path,headers=auth(student)).json()['closed'] is True
    assert client.post(path+'/telemetry',json=payload,headers=auth(student)).status_code == 403
    assert client.post(path+'/join',json={'name':'Bob','client_id':str(uuid.uuid4()),'invitation':teacher['invitation'],'consent':True,'privacy_mode':'mesh'}).status_code == 409


def test_role_room_and_signature_authorization(client):
    room = create_room(client)
    other = create_room(client)
    student = join(client, room)
    path=f"/rooms/{room['room_id']}"
    assert client.get(path+'/roster').status_code == 401
    assert client.get(path+'/roster',headers=auth(student)).status_code == 403
    assert client.get(path+'/report.csv',headers=auth(student)).status_code == 403
    assert client.post(path+'/close',json={},headers=auth(student)).status_code == 403
    assert client.get(path+'/roster',headers=auth(other)).status_code == 401
    assert client.get(path+'/roster',headers={'Authorization':'Bearer fake'}).status_code == 401
    assert client.post(path+'/telemetry',json={'samples':[sample()]},headers=auth(room)).status_code == 403


def test_unknown_observations_remain_unscored(client):
    room=create_room(client); student=join(client,room); path=f"/rooms/{room['room_id']}"
    unknown={'sample_id':str(uuid.uuid4()),'is_unknown':True,'cei_score':None,'attentiveness':None,'distraction':None}
    assert client.post(path+'/telemetry',json={'samples':[unknown]},headers=auth(student)).status_code == 200
    row=client.get(path+'/roster',headers=auth(room)).json()['students'][0]
    assert row['avg_cei'] is None
    assert row['latest']['status']=='Observation Insufficient'
    assert row['online'] is True


def test_scores_and_payload_size_are_validated(client):
    room=create_room(client); student=join(client,room); path=f"/rooms/{room['room_id']}/telemetry"
    invalid=sample(); invalid['cei_score']=2
    assert client.post(path,json={'samples':[invalid]},headers=auth(student)).status_code==422
    assert client.post(path,json={'samples':[sample() for _ in range(101)]},headers=auth(student)).status_code==422
    missing=sample(); missing['cei_score']=None
    assert client.post(path,json={'samples':[missing]},headers=auth(student)).status_code==422


def test_login_rate_limit_and_no_default_password(client):
    for _ in range(10):
        assert client.post('/rooms',json={'name':'Math','password':'admin123'}).status_code==401
    assert client.post('/rooms',json={'name':'Math','password':'admin123'}).status_code==429


def test_cors_only_allows_configured_frontend(client):
    allowed=client.options('/rooms',headers={'Origin':'https://class.example','Access-Control-Request-Method':'POST'})
    assert allowed.headers['access-control-allow-origin']=='https://class.example'
    blocked=client.options('/rooms',headers={'Origin':'https://attacker.example','Access-Control-Request-Method':'POST'})
    assert 'access-control-allow-origin' not in blocked.headers


def test_student_leave_and_csv_formula_escaping(client):
    room=create_room(client); student=join(client,room,'=HYPERLINK("x")'); path=f"/rooms/{room['room_id']}"
    assert client.post(path+'/telemetry',json={'samples':[sample()]},headers=auth(student)).status_code==200
    assert client.post(path+'/leave',json={},headers=auth(student)).status_code==200
    assert client.get(path+'/roster',headers=auth(room)).json()['students'][0]['online'] is False
    assert "'=HYPERLINK" in client.get(path+'/report.csv',headers=auth(room)).text


def test_configuration_and_database_health(client):
    assert client.get('/health').json()=={'status':'ok'}
    assert client.get('/config').json()['signaling']=={'host':'signal.example','port':443,'secure':True,'path':'/eduguard', 'iceServers':[{'urls':'stun:stun.l.google.com:19302'}]}


def test_admission_consent_and_invitation_are_required(client):
    room=create_room(client)
    payload={'name':'Alias','client_id':str(uuid.uuid4()),'privacy_mode':'mesh','consent':True,'invitation':room['invitation']}
    assert client.post(f"/rooms/{room['room_id']}/join",json={**payload,'consent':False}).status_code==422
    other=create_room(client)
    assert client.post(f"/rooms/{other['room_id']}/join",json=payload).status_code==403
    assert client.post(f"/rooms/{room['room_id']}/delete-data",json={},headers={'Authorization':'Bearer '+room['invitation']}).status_code==401


def test_deleted_session_cannot_upload_and_cannot_erase_peers(client):
    room=create_room(client);one=join(client,room);two=join(client,room,'Other')
    path=f"/rooms/{room['room_id']}"
    assert client.post(path+'/delete-data',json={},headers=auth(one)).status_code==200
    assert client.post(path+'/telemetry',json={'samples':[sample()]},headers=auth(one)).status_code==401
    rows=client.get(path+'/roster',headers=auth(room)).json()['students']
    assert [row['id'] for row in rows]==[two['session_id']]
    assert client.post(path+'/delete-data',json={},headers=auth(room)).status_code==200
    assert client.get(path+'/roster',headers=auth(room)).status_code==401


def test_retention_purges_expired_room_and_children(client):
    from sqlalchemy import update
    room=create_room(client);student=join(client,room)
    store=client.app.state.store
    with store.engine.begin() as conn:
        conn.execute(update(store.rooms).where(store.rooms.c.id==room['room_id']).values(created_at=0))
    store.purge(7)
    assert store.room(room['room_id']) is None


def test_raw_payload_fields_are_rejected(client):
    room=create_room(client);student=join(client,room)
    assert client.post(f"/rooms/{room['room_id']}/telemetry",headers=auth(student),json={'samples':[{**sample(),'landmarks':[1,2,3]}]}).status_code==422


@pytest.mark.parametrize('password', ['', 'admin123'])
def test_startup_does_not_require_shared_teacher_secret(tmp_path, password):
    settings=Settings(f"sqlite:///{tmp_path/'missing-secret.db'}",'s'*48,password,[],'https://signal.example')
    with TestClient(create_app(settings)) as api:
        assert api.get('/health').status_code == 200
        assert api.post('/rooms', json={'name':'Room','password':'admin123'}).status_code == 401


def test_resume_does_not_duplicate_attendance_and_close_is_global(client):
    room=create_room(client);one=join(client,room);two=join(client,room,'Other')
    path=f"/rooms/{room['room_id']}"
    assert client.post(path+'/heartbeat',json={},headers=auth(one)).status_code==200
    resumed=client.post(path+'/resume',json={'resume_ticket':one['resume_ticket']})
    assert resumed.status_code==200
    rows=client.get(path+'/roster',headers=auth(room)).json()['students']
    assert len(rows)==2 and {row['id'] for row in rows}=={one['session_id'],two['session_id']}
    assert client.post(path+'/close',json={},headers=auth(room)).status_code==200
    assert all(row['status']=='completed' and row['ended_at'] is not None for row in client.get(path+'/roster',headers=auth(room)).json()['students'])
    assert client.post(path+'/resume',json={'resume_ticket':one['resume_ticket']}).status_code==409


def test_late_recovery_preserves_events_without_reopening_completed_session(client):
    room=create_room(client);one=join(client,room);path=f"/rooms/{room['room_id']}"
    recorded=sample()
    assert client.post(path+'/close',json={},headers=auth(room)).status_code==200
    for _ in range(2):
        response=client.post(path+'/recover-telemetry',json={'resume_ticket':one['resume_ticket'],'samples':[recorded]})
        assert response.status_code==200
        assert response.json()['rejected_event_ids']==[]
    row=client.get(path+'/roster',headers=auth(room)).json()['students'][0]
    assert row['status']=='completed' and row['total_samples']==1 and not row['online']
    after=sample()
    response=client.post(path+'/recover-telemetry',json={'resume_ticket':one['resume_ticket'],'samples':[after]})
    assert response.json()['rejected_event_ids']==[after['sample_id']]
    assert client.post(path+'/delete-data',json={},headers=auth(one)).status_code==200
    assert client.post(path+'/recover-telemetry',json={'resume_ticket':one['resume_ticket'],'samples':[recorded]}).status_code==404

def test_expired_signed_access_and_invitation_tokens_are_rejected(client, monkeypatch):
    from itsdangerous.timed import TimestampSigner
    room = create_room(client)
    monkeypatch.setattr(TimestampSigner, 'get_timestamp', lambda self: int(time.time()) + 43201)
    assert client.get(f"/rooms/{room['room_id']}/roster", headers=auth(room)).status_code == 401
    response = client.post(f"/rooms/{room['room_id']}/join", json={
        'name': 'Alias', 'client_id': str(uuid.uuid4()), 'invitation': room['invitation'],
        'consent': True, 'privacy_mode': 'telemetry-only'})
    assert response.status_code == 403
