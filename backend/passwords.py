"""Teacher password hashing. Plaintext passwords and recovery codes are never stored."""
import hashlib
import secrets
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, type=Type.ID)
# Same-cost verification for nonexistent usernames; generated once per process.
_dummy = _hasher.hash(secrets.token_urlsafe(32))


def password_hash(password):
    return _hasher.hash(password)


def verify_password(encoded, password):
    try:
        result = _hasher.verify(encoded or _dummy, password)
        return bool(encoded) and result
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def recovery_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()
