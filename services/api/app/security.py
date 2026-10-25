"""Password hashing, access tokens and opaque refresh/invitation tokens."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import get_settings

_hasher = PasswordHasher()  # argon2id with library defaults (RFC 9106 recommended parameters)
# Pre-computed hash used to keep login timing similar whether or not the email exists.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    """Only digests of opaque tokens are stored, so a database leak does not expose usable tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(UTC)
    ttl = s.access_token_minutes * 60
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "typ": "access",
        "iss": s.jwt_issuer,
        "aud": s.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256"), ttl


def decode_access_token(token: str) -> dict:
    s = get_settings()
    claims = jwt.decode(
        token,
        s.jwt_secret.get_secret_value(),
        algorithms=["HS256"],
        audience=s.jwt_audience,
        issuer=s.jwt_issuer,
        options={"require": ["exp", "sub", "sid", "typ"]},
    )
    if claims.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return claims
