"""Request dependencies: authentication, tenant context and permission checks."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db, set_tenant
from .models import AuthSession, Membership, User
from .permissions import Perm, has_perm
from .security import decode_access_token

DB = Annotated[Session, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)

_UNAUTH = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})


@dataclass
class Principal:
    user: User
    session_id: uuid.UUID


def current_principal(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> Principal:
    if creds is None:
        raise _UNAUTH
    try:
        claims = decode_access_token(creds.credentials)
        user_id, session_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["sid"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise _UNAUTH from None
    session = db.get(AuthSession, session_id)
    if (
        session is None
        or session.user_id != user_id
        or session.revoked_at is not None
        or session.expires_at <= datetime.now(UTC)
    ):
        raise _UNAUTH
    user = db.get(User, user_id)
    if user is None:
        raise _UNAUTH
    set_tenant(db, user_id=user.id)
    return Principal(user=user, session_id=session_id)


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


@dataclass
class OrgContext:
    org_id: uuid.UUID
    membership: Membership
    principal: Principal

    @property
    def user(self) -> User:
        return self.principal.user


def org_context(org_id: uuid.UUID, db: DB, principal: CurrentPrincipal) -> OrgContext:
    # Non-members get 404 (not 403) so organisation IDs cannot be probed.
    set_tenant(db, org_id=org_id, user_id=principal.user.id)
    m = db.scalar(
        select(Membership).where(Membership.organization_id == org_id, Membership.user_id == principal.user.id)
    )
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation not found")
    return OrgContext(org_id=org_id, membership=m, principal=principal)


def require(perm: Perm):
    def _dep(ctx: Annotated[OrgContext, Depends(org_context)]) -> OrgContext:
        if not has_perm(ctx.membership.role, perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role ({ctx.membership.role.value}) cannot do this")
        return ctx

    return _dep


def client_meta(request: Request) -> dict[str, str | None]:
    return {
        "ip": request.client.host if request.client else None,
        "user_agent": (request.headers.get("user-agent") or "")[:300] or None,
    }
