"""Provider-neutral Phase 11 subscription rules. No payments or database writes.

The caller must authenticate tenant identity and persist transitions atomically.
This module cannot enable phone/media services or bypass their separate safety gates.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum


class SubscriptionState(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    PAUSED = "paused"
    CANCELED = "canceled"
    EXPIRED = "expired"


# Explicitly disallow reinstatement from terminal states without creating a new subscription.
_ALLOWED: dict[SubscriptionState, frozenset[SubscriptionState]] = {
    SubscriptionState.TRIALING: frozenset({SubscriptionState.ACTIVE, SubscriptionState.EXPIRED, SubscriptionState.CANCELED}),
    SubscriptionState.ACTIVE: frozenset({SubscriptionState.PAST_DUE, SubscriptionState.PAUSED, SubscriptionState.CANCELED}),
    SubscriptionState.PAST_DUE: frozenset({SubscriptionState.ACTIVE, SubscriptionState.PAUSED, SubscriptionState.CANCELED, SubscriptionState.EXPIRED}),
    SubscriptionState.PAUSED: frozenset({SubscriptionState.ACTIVE, SubscriptionState.CANCELED, SubscriptionState.EXPIRED}),
    SubscriptionState.CANCELED: frozenset(),
    SubscriptionState.EXPIRED: frozenset(),
}


@dataclass(frozen=True)
class PriceVersion:
    code: str
    currency: str
    minor_units: int

    def __post_init__(self) -> None:
        if not self.code or self.currency not in {"GBP", "INR"}:
            raise ValueError("Unsupported or unspecified price version")
        if type(self.minor_units) is not int or self.minor_units < 0:
            raise ValueError("Price must be nonnegative integer minor units")


@dataclass(frozen=True)
class Subscription:
    organization_id: str
    price: PriceVersion
    state: SubscriptionState
    effective_at: datetime

    def __post_init__(self) -> None:
        if not self.organization_id:
            raise ValueError("Tenant is required")
        if self.effective_at.tzinfo is None or self.effective_at.utcoffset() is None:
            raise ValueError("Effective timestamp must be timezone aware")


def transition(
    subscription: Subscription,
    next_state: SubscriptionState,
    *,
    at: datetime,
    organization_id: str,
) -> Subscription:
    """Validate one state change; authorization and atomic storage belong to the caller."""
    if organization_id != subscription.organization_id:
        raise PermissionError("Cross-tenant subscription transition")
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Transition timestamp must be timezone aware")
    if at.astimezone(UTC) < subscription.effective_at.astimezone(UTC):
        raise ValueError("Out-of-order transition timestamp")
    if next_state not in _ALLOWED[subscription.state]:
        raise ValueError("Invalid subscription transition")
    return Subscription(subscription.organization_id, subscription.price, next_state, at)


def can_create_paid_resource(subscription: Subscription, *, at: datetime) -> bool:
    """Commercial gate only; never substitutes for consent, model or phone safety gates."""
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Timestamp must be timezone aware")
    return subscription.state in {SubscriptionState.TRIALING, SubscriptionState.ACTIVE} and (
        at.astimezone(UTC) >= subscription.effective_at.astimezone(UTC)
    )
