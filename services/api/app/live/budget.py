"""Monthly caps on live (billable) provider usage, per workspace and across all workspaces.

Checks run before each provider call against the worst case that call can consume;
actual usage is recorded afterwards as an idempotent ``live`` usage event. Concurrent
calls can each pass the check, so a cap can be exceeded by at most
(concurrent requests × per-request maximum). Keep caps conservative and set a hard
spending limit in each provider's own console as well.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import UsageEvent, UsageKind, UsageSource


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

    @property
    def remaining(self) -> int:
        return max(0, min(self.org_cap - self.org_used, self.global_cap - self.global_used))


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
    return Budget(kind, org_cap, global_cap, int(org_used or 0), int(global_used or 0))


def require_budget(db: Session, org_id: uuid.UUID, kind: UsageKind, needed: int) -> Budget:
    b = budget(db, org_id, kind)
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
