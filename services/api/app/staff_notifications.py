"""Durable staff notification scheduling. NO external transport is wired.

A queue row is NOT provider acceptance, remote delivery or staff acknowledgment.
These pure database transitions are testable with a fake adapter; importing
this module cannot send a real email, push message, SMS or telephone call.
Only an independently reviewed provider adapter may claim work in the future.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .models import (
    AuditLog,
    CallerMessage,
    CallerMessageStatus,
    StaffNotificationAttempt,
    StaffNotificationOutbox,
)

MAX_ATTEMPTS = 5
LEASE_SECONDS = 120
ERROR_CODES = frozenset(
    {"timeout", "network_error", "rate_limited", "temporary_reject", "permanent_reject", "lease_expired", "unknown"}
)
REF_PATTERN = re.compile(r"^[a-zA-Z0-9_.:-]{1,120}$")


class NotificationError(ValueError):
    pass


def enqueue_case(db: Session, case: CallerMessage) -> StaffNotificationOutbox | None:
    """Queue once in the caller-message transaction; store no caller content.

    A manually authored staff case is already on a human's desk. A case created
    by the AI or simulated voice worker needs a future external notification.
    The worker is intentionally NOT started, configured or authorized here.
    """
    if case.source not in ("ai_receptionist", "voice_worker"):
        return None
    existing = db.scalar(
        select(StaffNotificationOutbox).where(
            StaffNotificationOutbox.organization_id == case.organization_id,
            StaffNotificationOutbox.case_id == case.id,
            StaffNotificationOutbox.channel == "staff_email",
        )
    )
    if existing is not None:
        return existing
    row = StaffNotificationOutbox(
        organization_id=case.organization_id,
        case_id=case.id,
        channel="staff_email",
        status="pending",
        attempts=0,
        max_attempts=MAX_ATTEMPTS,
        next_attempt_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def cancel_queued_for_case(db: Session, case: CallerMessage) -> None:
    """Stop unleased processing in the same transaction that handles the case."""
    db.execute(
        update(StaffNotificationOutbox)
        .where(
            StaffNotificationOutbox.organization_id == case.organization_id,
            StaffNotificationOutbox.case_id == case.id,
            StaffNotificationOutbox.status.in_(("pending", "retry")),
        )
        .values(status="cancelled", updated_at=datetime.now(UTC))
    )


def _staff_has_acknowledged(db: Session, row: StaffNotificationOutbox) -> bool:
    return (
        db.scalar(
            select(AuditLog.id)
            .where(
                AuditLog.organization_id == row.organization_id,
                AuditLog.target_type == "caller_message",
                AuditLog.target_id == str(row.case_id),
                AuditLog.action == "case.staff_acknowledged",
            )
            .limit(1)
        )
        is not None
    )


def _attempt(
    db: Session,
    row: StaffNotificationOutbox,
    result: str,
    *,
    error_code: str | None = None,
    provider_ref: str | None = None,
) -> None:
    db.add(
        StaffNotificationAttempt(
            organization_id=row.organization_id,
            notification_id=row.id,
            attempt_number=row.attempts,
            result=result,
            error_code=error_code,
            provider_ref=provider_ref,
        )
    )


def lease_due(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime | None = None,
    limit: int = 10,
) -> list[StaffNotificationOutbox]:
    """Reserve due work without concurrent double-claims (SELECT SKIP LOCKED).

    This method does not call a provider. Caller/case content and recipient
    addresses are not present on outbox rows. The caller of this method must
    already have a tenant-scoped DB session; Postgres RLS enforces it.
    The caller MUST commit the reservation before an eventual external send.
    """
    if not 1 <= limit <= 100:
        raise NotificationError("Notification batch limit must be 1..100")
    now = now or datetime.now(UTC)
    rows = list(
        db.scalars(
            select(StaffNotificationOutbox)
            .where(
                StaffNotificationOutbox.organization_id == org_id,
                or_(
                    (
                        StaffNotificationOutbox.status.in_(("pending", "retry"))
                        & (StaffNotificationOutbox.next_attempt_at <= now)
                    ),
                    ((StaffNotificationOutbox.status == "leased") & (StaffNotificationOutbox.lease_until <= now)),
                ),
            )
            .order_by(StaffNotificationOutbox.next_attempt_at, StaffNotificationOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    )
    reserved: list[StaffNotificationOutbox] = []
    for row in rows:
        case = db.get(CallerMessage, row.case_id)
        if case is None or case.status == CallerMessageStatus.resolved or _staff_has_acknowledged(db, row):
            row.status, row.lease_until, row.lease_token = "cancelled", None, None
            row.updated_at = now
            continue
        if row.attempts >= row.max_attempts:
            row.status, row.lease_until, row.lease_token = "dead", None, None
            row.last_error_code = "lease_expired"
            row.updated_at = now
            _attempt(db, row, "dead", error_code="lease_expired")
            continue
        row.attempts += 1
        row.lease_token = uuid.uuid4()
        row.lease_until = now + timedelta(seconds=LEASE_SECONDS)
        row.status = "leased"
        row.updated_at = now
        _attempt(db, row, "reserved")
        reserved.append(row)
    db.flush()
    return reserved


def _owned_lease(
    db: Session,
    org_id: uuid.UUID,
    notification_id: uuid.UUID,
    lease_token: uuid.UUID,
) -> StaffNotificationOutbox:
    row = db.scalar(
        select(StaffNotificationOutbox)
        .where(
            StaffNotificationOutbox.organization_id == org_id,
            StaffNotificationOutbox.id == notification_id,
        )
        .with_for_update()
    )
    if row is None:
        raise NotificationError("Notification not found")
    if row.lease_token != lease_token:
        raise NotificationError("Notification claim is no longer valid")
    return row


def cancel_leased_if_handled(
    db: Session,
    org_id: uuid.UUID,
    notification_id: uuid.UUID,
    lease_token: uuid.UUID,
    *,
    now: datetime | None = None,
) -> bool:
    """Recheck case resolution and human acknowledgment before each dispatch.

    This is a second, tenant-scoped checkpoint after taking a lease. A prior
    reservation is NOT permission to notify staff after the case is handled.
    A real adapter still needs an approved external recipient/send policy.
    """
    row = _owned_lease(db, org_id, notification_id, lease_token)
    if row.status != "leased" or row.lease_until is None:
        raise NotificationError("Notification is not leased")
    if row.lease_until <= (now or datetime.now(UTC)):
        raise NotificationError("Notification lease has expired")
    case = db.get(CallerMessage, row.case_id)
    if case is not None and case.status != CallerMessageStatus.resolved and not _staff_has_acknowledged(db, row):
        return False
    row.status, row.lease_token, row.lease_until = "cancelled", None, None
    row.updated_at = now or datetime.now(UTC)
    db.flush()
    return True


def provider_accepted(
    db: Session,
    org_id: uuid.UUID,
    notification_id: uuid.UUID,
    lease_token: uuid.UUID,
    provider_ref: str,
    *,
    now: datetime | None = None,
) -> StaffNotificationOutbox:
    """Only trusted adapter code may call this after a provider's accepted receipt.

    This method does not prove remote mailbox delivery. No HTTP route exposes it.
    """
    if not REF_PATTERN.fullmatch(provider_ref):
        raise NotificationError("Invalid opaque provider reference")
    row = _owned_lease(db, org_id, notification_id, lease_token)
    if row.status == "provider_accepted" and row.provider_ref == provider_ref:
        return row
    if row.status != "leased" or row.lease_until is None or row.lease_until <= (now or datetime.now(UTC)):
        raise NotificationError("Notification lease has expired")
    now = now or datetime.now(UTC)
    row.status, row.lease_until, row.provider_ref = "provider_accepted", None, provider_ref
    row.provider_accepted_at, row.updated_at = now, now
    _attempt(db, row, "accepted", provider_ref=provider_ref)
    db.flush()
    return row


def retry_or_dead(
    db: Session,
    org_id: uuid.UUID,
    notification_id: uuid.UUID,
    lease_token: uuid.UUID,
    error_code: str,
    *,
    now: datetime | None = None,
) -> StaffNotificationOutbox:
    """Bounded retry with exponential backoff; raw provider errors/PII prohibited."""
    if error_code not in ERROR_CODES - {"lease_expired"}:
        raise NotificationError("Only non-personal, allowlisted error codes may be recorded")
    row = _owned_lease(db, org_id, notification_id, lease_token)
    if row.status != "leased":
        raise NotificationError("Notification is not leased")
    now = now or datetime.now(UTC)
    if row.lease_until is None or row.lease_until <= now:
        raise NotificationError("Notification lease has expired")
    terminal = row.attempts >= row.max_attempts or error_code == "permanent_reject"
    row.status = "dead" if terminal else "retry"
    row.next_attempt_at = now + timedelta(seconds=min(3600, 60 * 2 ** (row.attempts - 1)))
    row.lease_until = None
    row.last_error_code = error_code
    row.updated_at = now
    _attempt(db, row, "dead" if terminal else "retry", error_code=error_code)
    db.flush()
    return row


def record_delivered(
    db: Session,
    org_id: uuid.UUID,
    notification_id: uuid.UUID,
    provider_ref: str,
    *,
    now: datetime | None = None,
) -> StaffNotificationOutbox:
    """Trusted webhook adapter only. Provider acceptance is NOT delivery.

    Do not expose this method in a caller- or staff-facing HTTP endpoint.
    Provider signature verification, workspace binding and event deduplication
    must be implemented in a separately approved transport adapter.
    """
    row = db.scalar(
        select(StaffNotificationOutbox)
        .where(
            StaffNotificationOutbox.organization_id == org_id,
            StaffNotificationOutbox.id == notification_id,
        )
        .with_for_update()
    )
    if row is None or row.provider_ref != provider_ref or not REF_PATTERN.fullmatch(provider_ref):
        raise NotificationError("Unknown notification delivery receipt")
    if row.status == "delivered":
        return row
    if row.status != "provider_accepted":
        raise NotificationError("Provider acceptance required before delivery receipt")
    row.status = "delivered"
    row.delivered_at, row.updated_at = (now or datetime.now(UTC)), (now or datetime.now(UTC))
    db.flush()
    return row
