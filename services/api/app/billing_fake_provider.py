"""Fake-only billing subscription lifecycle; no charge, payment credentials or network.

The caller supplies an authenticated tenant context and persists state changes
atomically. This adapter deliberately cannot process real payment webhooks.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.billing_policy import PriceVersion, Subscription, SubscriptionState, transition


class FakeBillingEventKind(StrEnum):
    TRIAL_ACTIVATED = "trial_activated"
    PAYMENT_SUCCEEDED = "payment_succeeded"
    PAYMENT_FAILED = "payment_failed"
    SUBSCRIPTION_PAUSED = "subscription_paused"
    SUBSCRIPTION_RESUMED = "subscription_resumed"
    SUBSCRIPTION_CANCELED = "subscription_canceled"
    TRIAL_EXPIRED = "trial_expired"


_NEXT_STATE = {
    FakeBillingEventKind.TRIAL_ACTIVATED: SubscriptionState.TRIALING,
    FakeBillingEventKind.PAYMENT_SUCCEEDED: SubscriptionState.ACTIVE,
    FakeBillingEventKind.PAYMENT_FAILED: SubscriptionState.PAST_DUE,
    FakeBillingEventKind.SUBSCRIPTION_PAUSED: SubscriptionState.PAUSED,
    FakeBillingEventKind.SUBSCRIPTION_RESUMED: SubscriptionState.ACTIVE,
    FakeBillingEventKind.SUBSCRIPTION_CANCELED: SubscriptionState.CANCELED,
    FakeBillingEventKind.TRIAL_EXPIRED: SubscriptionState.EXPIRED,
}


@dataclass(frozen=True)
class FakeBillingEvent:
    event_id: str
    organization_id: str
    kind: FakeBillingEventKind
    occurred_at: datetime

    def __post_init__(self) -> None:
        if not self.event_id or not self.organization_id:
            raise ValueError("Fake event identity required")
        if not isinstance(self.kind, FakeBillingEventKind):
            raise ValueError("Unsupported fake billing event")
        if (
            not isinstance(self.occurred_at, datetime)
            or self.occurred_at.tzinfo is None
            or self.occurred_at.utcoffset() is None
        ):
            raise ValueError("Fake billing timestamp must be timezone aware")


def apply_fake_billing_event(
    current: Subscription | None,
    event: FakeBillingEvent,
    *,
    initial_price: PriceVersion | None = None,
) -> Subscription:
    """Apply a fake event with strict tenant and transition checks.

    Event-ID idempotency must be enforced separately by the durable provider inbox.
    """
    if current is None:
        if event.kind is not FakeBillingEventKind.TRIAL_ACTIVATED or initial_price is None:
            raise ValueError("Fake subscription must begin with a priced trial")
        return Subscription(event.organization_id, initial_price, SubscriptionState.TRIALING, event.occurred_at)
    if event.kind is FakeBillingEventKind.TRIAL_ACTIVATED:
        raise ValueError("Existing subscription cannot restart a trial")
    return transition(current, _NEXT_STATE[event.kind], at=event.occurred_at, organization_id=event.organization_id)
