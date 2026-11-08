"""Scoped, short-lived credentials for the voice worker (ADR-0005 §3).

A worker token lets a voice worker ask the receptionist brain to answer one workspace's calls, and
nothing else:
- signed with its own secret, ``VOXERA_WORKER_SECRET`` (never the user-session JWT secret), so a
  leaked worker token cannot act as a user and a user token cannot act as a worker;
- one workspace (``org``), one scope (``live:brain``), audience ``voxera-worker-brain``;
- lifetime at most 15 minutes; the worker refreshes it from its operator, never stores user passwords.

With no worker secret configured the worker endpoint answers 404, as if it did not exist. It is
off by default and needs the owner's approval to enable on any hosted environment.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt

from .config import get_settings

ISSUER = "voxera-api"
AUDIENCE = "voxera-worker-brain"
SCOPE = "live:brain"
MAX_TTL = timedelta(minutes=15)


class WorkerAuthError(Exception):
    """The token is missing, invalid, expired or out of scope. Safe to show: no token content."""


def _secret() -> str | None:
    s = get_settings().worker_secret
    return s.get_secret_value() if s is not None else None


def enabled() -> bool:
    return _secret() is not None


MODES = ("test", "live")
CHANNELS = ("simulated", "phone")  # "phone": audio from the telephone network (SIP); always live


def mint(
    org_id: uuid.UUID,
    ttl: timedelta = MAX_TTL,
    now: datetime | None = None,
    mode: str = "test",
    channel: str = "simulated",
) -> str:
    """``mode`` "live" is for real callers and is refused for a business whose country is not
    launch-ready (app/voice/launch.py); "test" is for simulated and internal calls. A ``channel``
    of "phone" (a real telephone call) is always live, so test mode cannot bypass the launch gate;
    the worker also refuses to answer a telephone participant without a live phone token."""
    secret = _secret()
    if secret is None:
        raise WorkerAuthError("Worker credentials are not enabled")
    if not timedelta(0) < ttl <= MAX_TTL:
        raise WorkerAuthError("Worker tokens last at most 15 minutes")
    if mode not in MODES:
        raise WorkerAuthError("Unknown worker mode")
    _check_channel(mode, channel)
    now = now or datetime.now(UTC)
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "voice-worker",
        "org": str(org_id),
        "scope": SCOPE,
        "mode": mode,
        "channel": channel,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def _check_channel(mode: str, channel: object) -> None:
    if channel not in CHANNELS:
        raise WorkerAuthError("Unknown worker channel")
    if channel == "phone" and mode != "live":
        raise WorkerAuthError("Telephone calls need a live token; test mode is for simulated calls only")


def verify(token: str) -> tuple[uuid.UUID, str]:
    """The workspace the token is for and its mode. Raises WorkerAuthError for anything else."""
    secret = _secret()
    if secret is None:
        raise WorkerAuthError("Worker credentials are not enabled")
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "aud", "iss", "org", "scope", "mode", "channel"]},
        )
    except jwt.PyJWTError:
        raise WorkerAuthError("Invalid or expired worker token") from None
    if claims.get("scope") != SCOPE:
        raise WorkerAuthError("Token is not for the brain")
    if claims.get("mode") not in MODES:
        raise WorkerAuthError("Unknown worker mode")
    _check_channel(claims["mode"], claims.get("channel"))
    if claims["exp"] - claims["iat"] > MAX_TTL.total_seconds():
        raise WorkerAuthError("Token lifetime too long")
    try:
        return uuid.UUID(claims["org"]), claims["mode"]
    except (ValueError, TypeError):
        raise WorkerAuthError("Invalid workspace in token") from None
