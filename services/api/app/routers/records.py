"""Audit log reading and usage metering."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..models import AuditLog, UsageEvent, UsageKind, UsageSource
from ..permissions import Perm
from ..schemas import AuditOut, UsageIn, UsageOut, UsageSummary

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["records"])


@router.get("/audit-logs", response_model=list[AuditOut])
def audit_logs(
    ctx: Annotated[OrgContext, Depends(require(Perm.audit_read))],
    db: DB,
    limit: int = Query(50, ge=1, le=200),
    before: datetime | None = None,
    action: str | None = None,
) -> list[AuditLog]:
    q = select(AuditLog).where(AuditLog.organization_id == ctx.org_id)
    if before:
        q = q.where(AuditLog.created_at < before)
    if action:
        q = q.where(AuditLog.action == action)
    return list(db.scalars(q.order_by(AuditLog.created_at.desc(), AuditLog.id).limit(limit)))


@router.post("/usage-events", response_model=UsageOut, status_code=status.HTTP_201_CREATED)
def record_usage(
    body: UsageIn,
    ctx: Annotated[OrgContext, Depends(require(Perm.usage_write))],
    db: DB,
    request: Request,
    response: Response,
) -> UsageEvent:
    """Idempotent: replaying the same idempotency_key returns the original event (200) and never double-counts."""
    stmt = (
        insert(UsageEvent)
        .values(organization_id=ctx.org_id, **body.model_dump())
        .on_conflict_do_nothing(constraint="uq_usage_idempotency")
        .returning(UsageEvent.id)
    )
    new_id = db.execute(stmt).scalar()
    ev = db.scalar(
        select(UsageEvent).where(
            UsageEvent.organization_id == ctx.org_id, UsageEvent.idempotency_key == body.idempotency_key
        )
    )
    assert ev is not None
    if new_id is None:
        same = (ev.kind, ev.source, ev.quantity, ev.occurred_at) == (
            body.kind,
            body.source,
            body.quantity,
            body.occurred_at,
        )
        if not same:
            raise HTTPException(status.HTTP_409_CONFLICT, "Idempotency key already used with different values")
        response.status_code = status.HTTP_200_OK
    else:
        audit.record(
            db,
            ctx.org_id,
            ctx.user.id,
            "usage.recorded",
            "usage_event",
            ev.id,
            {"kind": body.kind.value, "source": body.source.value, "quantity": str(body.quantity)},
            client_meta(request),
        )
    db.commit()
    return ev


@router.get("/usage/summary", response_model=UsageSummary)
def usage_summary(
    ctx: Annotated[OrgContext, Depends(require(Perm.usage_read))],
    db: DB,
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
) -> UsageSummary:
    y, m = map(int, month.split("-"))
    start = datetime(y, m, 1, tzinfo=UTC)
    end = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=UTC)
    rows = db.execute(
        select(UsageEvent.source, UsageEvent.kind, func.sum(UsageEvent.quantity), func.count())
        .where(UsageEvent.organization_id == ctx.org_id, UsageEvent.occurred_at >= start, UsageEvent.occurred_at < end)
        .group_by(UsageEvent.source, UsageEvent.kind)
    ).all()
    totals: dict[UsageSource, dict[str, Decimal]] = {s: {k.value: Decimal(0) for k in UsageKind} for s in UsageSource}
    count = 0
    for source, kind, qty, n in rows:
        totals[source][kind.value] = Decimal(qty)
        count += n
    return UsageSummary(
        month=month, live=totals[UsageSource.live], simulated=totals[UsageSource.simulated], event_count=count
    )
