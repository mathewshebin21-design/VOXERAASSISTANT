"""Pure Phase 11 policy tests: no payment, database or external providers."""

from datetime import UTC, datetime, timedelta

import pytest

from app.billing_policy import (
    PriceVersion,
    Subscription,
    SubscriptionState,
    can_create_paid_resource,
    transition,
)

NOW = datetime(2026, 11, 17, tzinfo=UTC)


def sample(state: SubscriptionState = SubscriptionState.TRIALING) -> Subscription:
    return Subscription("tenant-a", PriceVersion("uk-basic-v1", "GBP", 2900), state, NOW)


@pytest.mark.parametrize("currency", ["GBP", "INR"])
def test_price_version_accepts_integer_minor_units(currency):
    assert PriceVersion("v1", currency, 1234).minor_units == 1234


@pytest.mark.parametrize("amount", [-1, 1.5, True, "100"])
def test_price_rejects_invalid_minor_units(amount):
    with pytest.raises(ValueError):
        PriceVersion("v1", "INR", amount)


def test_rejects_unknown_currency():
    with pytest.raises(ValueError):
        PriceVersion("v1", "USD", 100)


def test_trial_to_active_and_then_past_due():
    active = transition(sample(), SubscriptionState.ACTIVE, at=NOW, organization_id="tenant-a")
    overdue = transition(active, SubscriptionState.PAST_DUE, at=NOW + timedelta(days=1), organization_id="tenant-a")
    assert overdue.state == SubscriptionState.PAST_DUE
    assert not can_create_paid_resource(overdue, at=NOW + timedelta(days=1))


def test_cross_tenant_transition_is_denied():
    with pytest.raises(PermissionError):
        transition(sample(), SubscriptionState.ACTIVE, at=NOW, organization_id="tenant-b")


def test_terminal_state_cannot_reactivate():
    with pytest.raises(ValueError):
        transition(sample(SubscriptionState.CANCELED), SubscriptionState.ACTIVE, at=NOW, organization_id="tenant-a")


def test_out_of_order_transition_is_denied():
    with pytest.raises(ValueError):
        transition(sample(), SubscriptionState.ACTIVE, at=NOW - timedelta(seconds=1), organization_id="tenant-a")


def test_naive_timestamp_is_denied():
    with pytest.raises(ValueError):
        transition(sample(), SubscriptionState.ACTIVE, at=datetime(2026, 11, 17), organization_id="tenant-a")


def test_paid_resource_gate_is_denied_for_inactive_states():
    for state in (
        SubscriptionState.PAST_DUE,
        SubscriptionState.PAUSED,
        SubscriptionState.CANCELED,
        SubscriptionState.EXPIRED,
    ):
        assert not can_create_paid_resource(sample(state), at=NOW)


def test_paid_resource_gate_does_not_allow_future_effective_date():
    assert not can_create_paid_resource(sample(), at=NOW - timedelta(seconds=1))


def test_no_implicit_reactivation_or_idempotent_duplicate_transition():
    with pytest.raises(ValueError):
        transition(sample(SubscriptionState.ACTIVE), SubscriptionState.ACTIVE, at=NOW, organization_id="tenant-a")
