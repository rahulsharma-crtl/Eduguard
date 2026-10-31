"""Legacy, process-local presence cache. Database state is authoritative."""
from functools import lru_cache, wraps
import threading
import time

_LOCK=threading.RLock()


def synchronized(function):
    @wraps(function)
    def guarded(*args,**kwargs):
        with _LOCK:return function(*args,**kwargs)
    return guarded


@lru_cache(maxsize=1)
def _state():return {}


@synchronized
def reset_state():_state().clear()


@synchronized
def get_shared_state():
    """Return a detached snapshot; callers cannot mutate the synchronized cache."""
    return {room:{key:dict(value) for key,value in people.items()} for room,people in _state().items()}


@synchronized
def prune_stale(max_age_seconds=3600,now=None):
    now=time.time() if now is None else now
    for room in list(_state()):
        for participant in list(_state()[room]):
            if now-_state()[room][participant]['last_seen']>max_age_seconds:del _state()[room][participant]
        if not _state()[room]:del _state()[room]


@synchronized
def update_student_presence(room_id,participant_id,cei_score,status,*,student_name=None):
    """participant_id must be a stable issued ID, never a display-name lookup."""
    if not participant_id:raise ValueError('Stable participant identifier required')
    people=_state().setdefault(room_id,{})
    now=time.time();joined=people.get(participant_id,{}).get('joined_at',now)
    people[participant_id]={'participant_id':participant_id,'student_name':student_name or participant_id,
        'cei_score':cei_score,'status':status,'last_seen':now,'joined_at':joined}


@synchronized
def get_live_students(room_id,timeout_seconds=6):
    prune_stale()
    now=time.time()
    return {key:dict(value) for key,value in _state().get(room_id,{}).items() if now-value['last_seen']<=timeout_seconds}


@synchronized
def get_total_joined_students(room_id):
    prune_stale()
    return [dict(value,last_score=value['cei_score']) for value in _state().get(room_id,{}).values()]
