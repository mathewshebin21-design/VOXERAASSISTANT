from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..deps import DB, CurrentPrincipal, client_meta
from ..models import AuthSession, RefreshToken, User
from ..provisioning import provision_organization
from ..ratelimit import SlidingWindowLimiter
from ..schemas import LoginIn, RefreshIn, SignupIn, TokenOut
from ..security import create_access_token, hash_password, needs_rehash, new_opaque_token, token_digest, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])
login_limiter = SlidingWindowLimiter(get_settings().login_attempts_per_minute)
_BAD_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")


def _issue(db: DB, user: User, request: Request, session: AuthSession | None = None) -> TokenOut:
    now = datetime.now(UTC)
    if session is None:
        session = AuthSession(
            user_id=user.id,
            expires_at=now + timedelta(days=get_settings().refresh_token_days),
            user_agent=client_meta(request)["user_agent"],
        )
        db.add(session)
        db.flush()
    refresh = new_opaque_token()
    db.add(RefreshToken(session_id=session.id, token_hash=token_digest(refresh)))
    access, ttl = create_access_token(user.id, session.id)
    return TokenOut(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/signup", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, db: DB, request: Request) -> TokenOut:
    user = User(email=body.email.lower(), full_name=body.full_name, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from None
    provision_organization(db, user, body.organization_name, client_meta(request))
    tokens = _issue(db, user, request)
    db.commit()
    return tokens


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: DB, request: Request) -> TokenOut:
    email = body.email.lower()
    meta = client_meta(request)
    if not login_limiter.allow(f"{email}|{meta['ip']}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a minute.")
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise _BAD_LOGIN
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    tokens = _issue(db, user, request)
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: DB, request: Request) -> TokenOut:
    now = datetime.now(UTC)
    rt = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_digest(body.refresh_token)).with_for_update()
    )
    if rt is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    session = db.get(AuthSession, rt.session_id)
    assert session is not None
    if rt.used_at is not None:
        # Reuse of a rotated token: assume it was stolen and end the whole session.
        session.revoked_at = session.revoked_at or now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token reuse detected; session revoked")
    if session.revoked_at is not None or session.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    rt.used_at = now
    user = db.get(User, session.user_id)
    assert user is not None
    tokens = _issue(db, user, request, session)
    db.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(principal: CurrentPrincipal, db: DB) -> None:
    db.execute(update(AuthSession).where(AuthSession.id == principal.session_id).values(revoked_at=datetime.now(UTC)))
    db.commit()


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(principal: CurrentPrincipal, db: DB) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == principal.user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()
