"""Transactional fake-only subscription lifecycle persistence.

Only a trusted, isolated fake adapter may invoke this writer. The caller must
authenticate the tenant, validate the raw event envelope, and commit atomically.
Never use this module for real payment-provider callbacks.
"""

import json
import uuid

from sqlalchemy import text

from app.billing_fake_provider import FakeBillingEvent, apply_fake_billing_event
from app.billing_policy import PriceVersion, Subscription, SubscriptionState
from app.billing_provider_inbox import record_synthetic_provider_event


def apply_fake_subscription_event(
    conn,
    *,
    event: FakeBillingEvent,
    raw_body: bytes,
    initial_price: PriceVersion | None = None,
) -> bool:
    """Apply a fake event exactly once; return False on identical durable replay."""
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != event.organization_id:
        raise PermissionError("Subscription tenant must match authenticated transaction")
    # Bind the immutable event envelope to the bytes recorded in the replay inbox.
    # Otherwise a caller could replay the same raw bytes with different event metadata.
    try:
        envelope = json.loads(raw_body)
    except (TypeError, ValueError) as exc:
        raise ValueError("Fake event requires a valid JSON envelope") from exc
    if not isinstance(envelope, dict) or set(envelope) != {"event_id", "organization_id", "kind", "occurred_at"}:
        raise ValueError("Fake event envelope fields do not match the contract")
    if envelope != {
        "event_id": event.event_id,
        "organization_id": event.organization_id,
        "kind": event.kind.value,
        "occurred_at": event.occurred_at.isoformat(),
    }:
        raise ValueError("Fake event envelope does not match trusted event context")
    # Serialize both initial creation and subsequent transitions for this tenant.
    locked = conn.execute(
        text("SELECT id FROM organizations WHERE id = :org FOR UPDATE"),
        {"org": event.organization_id},
    ).scalar_one_or_none()
    if locked is None:
        raise ValueError("Unknown subscription tenant")
    first = record_synthetic_provider_event(
        conn,
        organization_id=event.organization_id,
        provider="fake-subscription",
        provider_event_id=event.event_id,
        raw_body=raw_body,
    )
    if not first:
        return False
    row = conn.execute(
        text(
            "SELECT price_code, currency, price_minor_units, state, effective_at "
            "FROM billing_subscriptions WHERE organization_id = :org FOR UPDATE"
        ),
        {"org": event.organization_id},
    ).mappings().one_or_none()
    current = None
    if row is not None:
        current = Subscription(
            event.organization_id,
            PriceVersion(row["price_code"], row["currency"], row["price_minor_units"]),
            SubscriptionState(row["state"]),
            row["effective_at"],
        )
    updated = apply_fake_billing_event(current, event, initial_price=initial_price)
    if current is None:
        conn.execute(
            text(
                "INSERT INTO billing_subscriptions "
                "(id, organization_id, price_code, currency, price_minor_units, state, effective_at) "
                "VALUES (:id, :org, :code, :currency, :amount, :state, :at)"
            ),
            {
                "id": uuid.uuid4(),
                "org": event.organization_id,
                "code": updated.price.code,
                "currency": updated.price.currency,
                "amount": updated.price.minor_units,
                "state": updated.state.value,
                "at": updated.effective_at,
            },
        )
    else:
        conn.execute(
            text(
                "UPDATE billing_subscriptions SET state = :state, effective_at = :at "
                "WHERE organization_id = :org"
            ),
            {"state": updated.state.value, "at": updated.effective_at, "org": event.organization_id},
        )
    conn.execute(
        text(
            "UPDATE billing_provider_inbox SET status = 'reconciled' "
            "WHERE organization_id = :org AND provider = 'fake-subscription' AND provider_event_id = :event"
        ),
        {"org": event.organization_id, "event": event.event_id},
    )
    return True
