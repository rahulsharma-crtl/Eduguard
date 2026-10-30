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
    response = client.post(f"/rooms/{room['room_id']}/join", json={'name': name, 'client_id': str(uuid.uuid4())})
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
    assert client.get(path).json()['closed'] is True
    assert client.post(path+'/telemetry',json=payload,headers=auth(student)).status_code == 409
    assert client.post(path+'/join',json={'name':'Bob','client_id':str(uuid.uuid4())}).status_code == 409


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
