"""Monthly caps on live (billable) provider usage, per workspace and across all workspaces.

These caps count provider UNITS (language-model tokens, text-to-speech characters), not
money. VOXERA does not know a provider's prices or currency conversion, so it cannot
enforce a monetary limit; set a hard spending limit in each provider's own console as well.

Enforcement is by reservation (see migration 0006): before a call, ``reserve`` takes a
per-kind advisory lock, counts recorded usage plus open reservations, and inserts a
reservation for the call's worst case. Simultaneous requests are serialised by the lock,
so together they cannot reserve more than the cap. ``settle`` swaps the reservation for
the actual usage in one transaction. An unsettled reservation keeps counting (fails safe).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, set_tenant
from ..models import UsageEvent, UsageKind, UsageSource

log = logging.getLogger("voxera.live")


def month_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(UTC)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start, end


def caps(kind: UsageKind) -> tuple[int, int]:
    s = get_settings()
    if kind is UsageKind.llm_tokens:
        return s.live_llm_tokens_per_org_month, s.live_llm_tokens_global_month
    if kind is UsageKind.tts_characters:
        return s.live_tts_chars_per_org_month, s.live_tts_chars_global_month
    return 0, 0


@dataclass
class Budget:
    kind: UsageKind
    org_cap: int
    global_cap: int
    org_used: int
    global_used: int
    org_reserved: int = 0
    global_reserved: int = 0

    @property
    def remaining(self) -> int:
        return max(
            0,
            min(
                self.org_cap - self.org_used - self.org_reserved,
                self.global_cap - self.global_used - self.global_reserved,
            ),
        )


def budget(db: Session, org_id: uuid.UUID, kind: UsageKind) -> Budget:
    start, end = month_window()
    org_cap, global_cap = caps(kind)
    org_used = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
            UsageEvent.organization_id == org_id,
            UsageEvent.kind == kind,
            UsageEvent.source == UsageSource.live,
            UsageEvent.occurred_at >= start,
            UsageEvent.occurred_at < end,
        )
    )
    global_used = db.execute(
        text("SELECT live_usage_total(CAST(:k AS usage_kind), :s, :e)"), {"k": kind.value, "s": start, "e": end}
    ).scalar()
    org_reserved = db.execute(
        text("SELECT coalesce(sum(quantity), 0) FROM live_reservations WHERE organization_id = :o AND kind = :k"),
        {"o": org_id, "k": kind.value},
    ).scalar()
    global_reserved = db.execute(text("SELECT live_reserved_total(CAST(:k AS usage_kind))"), {"k": kind.value}).scalar()
    return Budget(
        kind,
        org_cap,
        global_cap,
        int(org_used or 0),
        int(global_used or 0),
        int(org_reserved or 0),
        int(global_reserved or 0),
    )


def _lock(db: Session, kind: UsageKind) -> None:
    """Serialises reservations of one usage kind across every worker until the transaction ends."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"voxera-live-budget:{kind.value}"})


def _key_used(db: Session, org_id: uuid.UUID, key: str) -> bool:
    used = db.scalar(
        select(func.count())
        .select_from(UsageEvent)
        .where(UsageEvent.organization_id == org_id, UsageEvent.idempotency_key == key)
    )
    held = db.execute(
        text("SELECT count(*) FROM live_reservations WHERE organization_id = :o AND idempotency_key = :k"),
        {"o": org_id, "k": key},
    ).scalar()
    return bool(used or held)


def reserve(db: Session, org_id: uuid.UUID, kind: UsageKind, needed: int, key: str) -> Budget:
    """Atomically checks the caps and holds `needed` units for one call. Commits."""
    if needed <= 0:
        raise ValueError("a reservation must be positive")
    db.rollback()  # start a fresh transaction so the lock is held only for this check
    try:
        _lock(db, kind)
        if _key_used(db, org_id, key):
            raise HTTPException(status.HTTP_409_CONFLICT, "This request id has already been used")
        b = check(budget(db, org_id, kind), needed)
        db.execute(
            text(
                "INSERT INTO live_reservations (organization_id, kind, quantity, idempotency_key) "
                "VALUES (:o, CAST(:k AS usage_kind), :q, :key)"
            ),
            {"o": org_id, "k": kind.value, "q": needed, "key": key},
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return b


def settle(org_id: uuid.UUID, user_id: uuid.UUID, kind: UsageKind, key: str, actual: int, ref: str) -> None:
    """Replaces a reservation with the usage actually consumed, in one transaction (own session)."""
    db = SessionLocal()
    try:
        set_tenant(db, org_id=org_id, user_id=user_id)
        if actual > 0:
            db.execute(
                insert(UsageEvent)
                .values(
                    organization_id=org_id,
                    kind=kind,
                    source=UsageSource.live,
                    quantity=actual,
                    occurred_at=datetime.now(UTC),
                    idempotency_key=key,
                    reference=ref,
                )
                .on_conflict_do_nothing(constraint="uq_usage_idempotency")
            )
        db.execute(
            text("DELETE FROM live_reservations WHERE organization_id = :o AND idempotency_key = :k"),
            {"o": org_id, "k": key},
        )
        db.commit()
    except Exception:  # never lose the response over metering; the reservation keeps counting (fails safe)
        db.rollback()
        log.exception("failed to settle live usage", extra={"org_id": str(org_id), "kind": kind.value, "qty": actual})
    finally:
        db.close()


def charge(db: Session, org_id: uuid.UUID, kind: UsageKind, qty: int, key: str, ref: str) -> Budget:
    """Checks the caps and records `qty` units straight away, atomically (for fixed-size calls like TTS)."""
    db.rollback()
    try:
        _lock(db, kind)
        if _key_used(db, org_id, key):
            raise HTTPException(status.HTTP_409_CONFLICT, "This request id has already been used")
        b = check(budget(db, org_id, kind), qty)
        db.add(
            UsageEvent(
                organization_id=org_id,
                kind=kind,
                source=UsageSource.live,
                quantity=qty,
                occurred_at=datetime.now(UTC),
                idempotency_key=key,
                reference=ref,
            )
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return b


def require_budget(db: Session, org_id: uuid.UUID, kind: UsageKind, needed: int) -> Budget:
    """A read-only pre-check (no reservation). Use `reserve` or `charge` before a billable call."""
    return check(budget(db, org_id, kind), needed)


def check(b: Budget, needed: int) -> Budget:
    kind = b.kind
    if b.org_cap == 0 or b.global_cap == 0:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "This live provider is switched off (no monthly cap set)"
        )
    if b.remaining < needed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Monthly live {kind.value.replace('_', ' ')} cap reached "
            f"({b.remaining} left, this request may need {needed})",
        )
    return b
