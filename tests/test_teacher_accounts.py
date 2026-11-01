import time
from sqlalchemy import select
from backend.app import Settings, create_app
from fastapi.testclient import TestClient
from backend.passwords import verify_password


def registered(client, username='teacher_one'):
    response=client.post('/teachers/register',json={'username':username,'password':'unique teacher passphrase 2026'})
    assert response.status_code==201,response.text
    assert response.headers.get('cache-control')=='no-store'
    return response.json()


def headers(account):
    return {'Authorization':'Bearer '+account['account_token']}


def test_teacher_accounts_hash_passwords_and_own_rooms(client):
    one=registered(client)
    two=registered(client,'teacher_two')
    with client.app.state.store.engine.connect() as conn:
        rows=conn.execute(select(client.app.state.store.teachers)).mappings().all()
    assert len(rows)==2
    assert rows[0]['password_hash'].startswith('$argon2id$')
    assert verify_password(rows[0]['password_hash'],'unique teacher passphrase 2026')
    assert one['recovery_code'] not in str(rows)
    assert rows[0]['password_hash']!=rows[1]['password_hash']
    room=client.post('/rooms',headers=headers(one),json={'name':'My class'}).json()
    assert client.get('/teachers/rooms',headers=headers(one)).json()['rooms'][0]['id']==room['room_id']
    assert client.get('/teachers/rooms',headers=headers(two)).json()['rooms']==[]
    assert client.post(f"/rooms/{room['room_id']}/teacher-resume",headers=headers(two),json={}).status_code==403
    assert client.get(f"/rooms/{room['room_id']}/roster",headers=headers(one)).status_code==401
    assert client.post('/rooms',headers={'Authorization':'Bearer '+room['token']},json={'name':'No'}).status_code==401


def test_registration_login_and_password_rules(client):
    account=registered(client,'Teacher_One')
    assert account['username']=='teacher_one'
    assert client.post('/teachers/register',json={'username':'teacher_one','password':'another unique password'}).status_code==409
    assert client.post('/teachers/register',json={'username':'short','password':'abc12'}).status_code==422
    assert client.post('/teachers/login',json={'username':'TEACHER_ONE','password':'unique teacher passphrase 2026'}).status_code==200
    for username in ['teacher_one','not_a_user']:
        response=client.post('/teachers/login',json={'username':username,'password':'wrong'})
        assert response.status_code==401 and response.json()['detail']=='Incorrect username or password'
    assert client.post('/teachers/register',json={'username':'bad name','password':'unique teacher passphrase 2026'}).status_code==422


def test_recovery_rotates_code_and_invalidates_account_and_room_tokens(client):
    one=registered(client)
    room=client.post('/rooms',headers=headers(one),json={'name':'My class'}).json()
    payload={'username':'teacher_one','password':'new unique teacher password','recovery_code':one['recovery_code']}
    recovered=client.post('/teachers/recover',json=payload)
    assert recovered.status_code==200
    current=recovered.json()
    assert current['recovery_code']!=one['recovery_code']
    assert client.get('/teachers/rooms',headers=headers(one)).status_code==401
    assert client.get(f"/rooms/{room['room_id']}/roster",headers={'Authorization':'Bearer '+room['token']}).status_code==401
    assert client.post('/teachers/recover',json=payload).status_code==401
    assert client.post('/teachers/login',json={'username':'teacher_one','password':'unique teacher passphrase 2026'}).status_code==401
    assert client.post('/teachers/login',json={'username':'teacher_one','password':'new unique teacher password'}).status_code==200
    reopened=client.post(f"/rooms/{room['room_id']}/teacher-resume",headers=headers(current),json={})
    assert reopened.status_code==200
    assert client.get(f"/rooms/{room['room_id']}/roster",headers={'Authorization':'Bearer '+reopened.json()['token']}).status_code==200


def test_accounts_persist_across_restart_without_shared_secret(tmp_path):
    settings=Settings(f"sqlite:///{tmp_path/'accounts.db'}",'s'*48,'',[],'https://signal.example')
    with TestClient(create_app(settings)) as api:
        registered(api)
    with TestClient(create_app(settings)) as api:
        response=api.post('/teachers/login',json={'username':'teacher_one','password':'unique teacher passphrase 2026'})
        assert response.status_code==200
        assert 'recovery_code' not in response.json()


def test_account_auth_expiry_and_rate_limit(client,monkeypatch):
    from itsdangerous.timed import TimestampSigner
    one=registered(client)
    monkeypatch.setattr(TimestampSigner,'get_timestamp',lambda self:int(time.time())+43201)
    assert client.get('/teachers/rooms',headers=headers(one)).status_code==401
    for _ in range(9):
        assert client.post('/teachers/login',json={'username':'missing','password':'wrong'}).status_code==401
    assert client.post('/teachers/login',json={'username':'missing','password':'wrong'}).status_code==429

from tests.test_api import client


def test_six_character_password_allowed_for_signup_and_recovery(client):
    response=client.post('/teachers/register',json={'username':'six_char_teacher','password':'Ab7!xy'})
    assert response.status_code==201
    account=response.json()
    response=client.post('/teachers/recover',json={'username':'six_char_teacher','password':'Zx8!ab','recovery_code':account['recovery_code']})
    assert response.status_code==200
    assert client.post('/teachers/login',json={'username':'six_char_teacher','password':'Zx8!ab'}).status_code==200
