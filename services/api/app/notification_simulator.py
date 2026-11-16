"""Explicit test-database-only outbox dispatcher.

No provider client, HTTP call, SMTP, webhook handler, scheduler or real
recipient is imported or used. This module cannot send an external message.
It exercises the durable claim/commit/resolve contract using only a strictly
typed in-memory simulator and a dedicated `voxera_test` Postgres database.

IMPORTANT: VOXERA_ENV=test is not a phone launch override and this module
must never be connected to SIP, live providers or the production runtime.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from . import staff_notifications
from .config import get_settings
from .db import set_tenant


class SimulationDisabled(RuntimeError):
    pass


@dataclass
class SimulatedTransport:
    """In-memory test stand-in. No recipients, network access or message body."""

    outcomes: dict[uuid.UUID, str] = field(default_factory=dict)
    submitted_ids: list[uuid.UUID] = field(default_factory=list)

    def simulate(self, notification_id: uuid.UUID) -> tuple[str, str]:
        self.submitted_ids.append(notification_id)
        outcome = self.outcomes.get(notification_id, "accepted")
        if outcome not in ("accepted", "rate_limited", "temporary_reject", "permanent_reject"):
            raise ValueError("Unsupported simulated outcome")
        return outcome, f"sim-{notification_id.hex}"


@dataclass(frozen=True)
class SimulatedResult:
    notification_id: uuid.UUID
    state: str
    attempted: bool


def _test_database_only(db: Session) -> None:
    """Two independent guards, both checked before ANY write."""
    if get_settings().env != "test" or db.get_bind().url.database != "voxera_test":
        raise SimulationDisabled("Simulation requires VOXERA_ENV=test and the dedicated voxera_test database")


def simulate_batch(
    session_factory: Callable[[], Session],
    org_id: uuid.UUID,
    transport: SimulatedTransport,
    *,
    now: datetime | None = None,
    limit: int = 10,
) -> list[SimulatedResult]:
    """Exercise commit-before-dispatch without installing a sender.

    1. Commit leases in Postgres. 2. Recheck case acknowledgement/resolution
    and commit cancellation. 3. Record a synthetic provider result in a NEW
    transaction. No synthetic "accepted" result counts as delivered; a
    separate trusted provider callback will be required in production.
    """
    if type(transport) is not SimulatedTransport:
        raise SimulationDisabled("Only the in-memory simulator is supported")
    when = now or datetime.now(UTC)
    with session_factory() as db:
        _test_database_only(db)
        set_tenant(db, org_id=org_id)
        leased = staff_notifications.lease_due(db, org_id, now=when, limit=limit)
        claims = [(row.id, row.lease_token) for row in leased]
        db.commit()

    results: list[SimulatedResult] = []
    for notification_id, token in claims:
        if token is None:
            raise RuntimeError("Missing durable lease token")
        with session_factory() as db:
            _test_database_only(db)
            set_tenant(db, org_id=org_id)
            cancelled = staff_notifications.cancel_leased_if_handled(db, org_id, notification_id, token, now=when)
            db.commit()
        if cancelled:
            results.append(SimulatedResult(notification_id, "cancelled", False))
            continue

        outcome, fake_ref = transport.simulate(notification_id)
        with session_factory() as db:
            _test_database_only(db)
            set_tenant(db, org_id=org_id)
            if outcome == "accepted":
                row = staff_notifications.provider_accepted(db, org_id, notification_id, token, fake_ref, now=when)
            else:
                row = staff_notifications.retry_or_dead(db, org_id, notification_id, token, outcome, now=when)
            state = row.status
            db.commit()
        results.append(SimulatedResult(notification_id, state, True))
    return results
