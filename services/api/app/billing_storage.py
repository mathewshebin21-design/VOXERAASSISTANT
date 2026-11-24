"""Atomic, synthetic-only usage ledger acceptance writer.

Not a public API or billable metering path. The production ingestion adapter must
authenticate provenance and derive synthetic status from trusted call context.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import text

from app.billing_usage import UsageEvent, UsageKind, UsageReplayConflict, reconcile_replay


def record_synthetic_usage(conn, event: UsageEvent, *, occurred_at: datetime | None = None) -> bool:
    """Insert once within caller's transaction; return True if inserted.

    PostgreSQL's unique constraint serializes concurrent same-key inserts.
    On conflict, compare the immutable payload and fail closed on mismatch.
    Caller must set the authenticated tenant on the transaction first.
    """
    if not event.synthetic:
        raise PermissionError("Real usage requires an authenticated provider ingestion adapter")
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != event.organization_id:
        raise PermissionError("Usage tenant must match authenticated transaction context")
    when = datetime.now(UTC) if occurred_at is None else occurred_at
    if when.tzinfo is None or when.utcoffset() is None:
        raise ValueError("Usage timestamp must be timezone aware")
    inserted = conn.execute(
        text(
            """
            INSERT INTO billing_usage_events
                (id, organization_id, provider, source_event_id, kind, units, synthetic, occurred_at)
            VALUES (:id, :org, :provider, :source, :kind, :units, true, :occurred)
            ON CONFLICT (organization_id, provider, source_event_id) DO NOTHING
            RETURNING id
            """
        ),
        {
            "id": uuid.uuid4(),
            "org": event.organization_id,
            "provider": event.provider,
            "source": event.source_event_id,
            "kind": event.kind.value,
            "units": event.units,
            "occurred": when,
        },
    ).scalar_one_or_none()
    if inserted is not None:
        return True
    row = (
        conn.execute(
            text(
                "SELECT organization_id, provider, source_event_id, kind, units, synthetic, occurred_at "
                "FROM billing_usage_events "
                "WHERE organization_id = :org AND provider = :provider AND source_event_id = :source"
            ),
            {"org": event.organization_id, "provider": event.provider, "source": event.source_event_id},
        )
        .mappings()
        .one()
    )
    previous = UsageEvent(
        organization_id=str(row["organization_id"]),
        source_event_id=row["source_event_id"],
        kind=UsageKind(row["kind"]),
        units=row["units"],
        synthetic=row["synthetic"],
        provider=row["provider"],
    )
    reconcile_replay(previous, event)
    if occurred_at is not None and row["occurred_at"] != when:
        raise UsageReplayConflict("Usage event identity reused with conflicting occurrence timestamp")
    return False
