"""Database engine and tenant-scoped sessions.

Tenant isolation is enforced twice:
1. In application code — every tenant query is filtered by organization_id.
2. In Postgres — row-level security policies compare each row's organization_id
   with the transaction-local setting ``app.org_id``. The API connects as a
   role that does not own the tables, so the policies always apply.

The settings are re-applied at the start of every transaction (including after
a commit) via the ``after_begin`` event, using ``set_config(..., true)`` so they
never leak to the next request that reuses the pooled connection.
"""

from collections.abc import Iterator
from uuid import UUID

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from .config import get_settings

engine = create_engine(get_settings().database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=True)


def set_tenant(
    session: Session, *, org_id: UUID | None = None, user_id: UUID | None = None, invite_hash: str | None = None
) -> None:
    """Record the RLS context on the session and apply it to the current transaction, if any."""
    ctx = session.info.setdefault("rls", {})
    if org_id is not None:
        ctx["org_id"] = str(org_id)
    if user_id is not None:
        ctx["user_id"] = str(user_id)
    if invite_hash is not None:
        ctx["invite_hash"] = invite_hash
    if session.in_transaction():
        _apply(session.connection(), ctx)


def _apply(conn: Connection, ctx: dict[str, str]) -> None:
    conn.exec_driver_sql(
        "SELECT set_config('app.org_id', %s, true), set_config('app.user_id', %s, true), "
        "set_config('app.invite_hash', %s, true)",
        (ctx.get("org_id", ""), ctx.get("user_id", ""), ctx.get("invite_hash", "")),
    )


@event.listens_for(Session, "after_begin")
def _after_begin(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
    ctx = session.info.get("rls")
    if ctx:
        _apply(connection, ctx)


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
