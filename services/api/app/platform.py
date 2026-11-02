"""Hosted-database settings, derived from the variables a Vercel–Neon connection injects.

When the API runs on Vercel with a Neon database attached, Vercel provides the owner
connection strings (``DATABASE_URL`` pooled, ``DATABASE_URL_UNPOOLED`` direct). From those:

- migrations run as the owner, over the direct connection;
- the API runs as ``voxera_app``, a role that owns nothing, so row-level security applies;
- that role's password and the JWT signing secret are derived from the owner password
  with HMAC-SHA256, so no extra secret has to be created, copied or stored anywhere.
  Rotating the database password in Neon rotates both (and signs everyone out).

Explicit ``VOXERA_*`` variables always win over anything derived here.
"""

import hashlib
import hmac
import os
import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit

APP_ROLE = os.environ.get("VOXERA_APP_ROLE", "voxera_app")
if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", APP_ROLE):
    raise ValueError("VOXERA_APP_ROLE must be a plain lower-case identifier")


def _first(*names: str) -> str | None:
    return next((os.environ[n] for n in names if os.environ.get(n)), None)


def _psycopg(url: str, user: str | None = None, password: str | None = None) -> str:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host += f":{parts.port}"
    user = user if user is not None else unquote(parts.username or "")
    password = password if password is not None else unquote(parts.password or "")
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}"
    return urlunsplit(("postgresql+psycopg", netloc, parts.path, parts.query, ""))


def derive(secret: str, purpose: str) -> str:
    return hmac.new(secret.encode(), f"voxera:{purpose}".encode(), hashlib.sha256).hexdigest()


def hosted_overrides() -> dict[str, str]:
    """Settings implied by a hosted Postgres connection, or {} when none is attached."""
    pooled = _first("DATABASE_URL", "POSTGRES_URL")
    direct = _first("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING") or pooled
    if not pooled or not direct:
        return {}
    owner_password = unquote(urlsplit(direct).password or "")
    if not owner_password:
        return {}
    return {
        "database_url": _psycopg(pooled, APP_ROLE, derive(owner_password, "app-role")),
        "migration_database_url": _psycopg(direct),
        "jwt_secret": derive(owner_password, "jwt"),
    }


def migration_owner_url() -> str | None:
    direct = _first("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL")
    return _psycopg(direct) if direct and urlsplit(direct).password else None


def app_role_password() -> str | None:
    owner = migration_owner_url()
    pw = unquote(urlsplit(owner).password or "") if owner else ""
    return derive(pw, "app-role") if pw else None
