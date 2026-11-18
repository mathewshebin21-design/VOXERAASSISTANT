"""Fake billing subscription lifecycle policy tests."""

from datetime import UTC, datetime, timedelta, tzinfo

import pytest

from app.billing_fake_provider import FakeBillingEvent, FakeBillingEventKind, apply_fake_billing_event
from app.billing_policy import PriceVersion, SubscriptionState

NOW = datetime(2026, 11, 17, tzinfo=UTC)
PRICE = PriceVersion("uk-basic-v1", "GBP", 2900)


def event(kind, *, at=NOW, org="tenant-a", event_id="evt-1"):
    return FakeBillingEvent(event_id, org, kind, at)


def test_fake_trial_payment_failure_recovery_and_cancel():
    trial = apply_fake_billing_event(None, event(FakeBillingEventKind.TRIAL_ACTIVATED), initial_price=PRICE)
    active = apply_fake_billing_event(
        trial, event(FakeBillingEventKind.PAYMENT_SUCCEEDED, at=NOW + timedelta(minutes=1))
    )
    overdue = apply_fake_billing_event(
        active, event(FakeBillingEventKind.PAYMENT_FAILED, at=NOW + timedelta(minutes=2))
    )
    recovered = apply_fake_billing_event(
        overdue, event(FakeBillingEventKind.PAYMENT_SUCCEEDED, at=NOW + timedelta(minutes=3))
    )
    canceled = apply_fake_billing_event(
        recovered, event(FakeBillingEventKind.SUBSCRIPTION_CANCELED, at=NOW + timedelta(minutes=4))
    )
    assert [s.state for s in (trial, active, overdue, recovered, canceled)] == [
        SubscriptionState.TRIALING,
        SubscriptionState.ACTIVE,
        SubscriptionState.PAST_DUE,
        SubscriptionState.ACTIVE,
        SubscriptionState.CANCELED,
    ]


def test_fake_trial_expiration_is_terminal():
    trial = apply_fake_billing_event(None, event(FakeBillingEventKind.TRIAL_ACTIVATED), initial_price=PRICE)
    expired = apply_fake_billing_event(trial, event(FakeBillingEventKind.TRIAL_EXPIRED))
    assert expired.state is SubscriptionState.EXPIRED
    with pytest.raises(ValueError):
        apply_fake_billing_event(expired, event(FakeBillingEventKind.PAYMENT_SUCCEEDED))


def test_fake_subscription_rejects_foreign_tenant():
    trial = apply_fake_billing_event(None, event(FakeBillingEventKind.TRIAL_ACTIVATED), initial_price=PRICE)
    with pytest.raises(PermissionError):
        apply_fake_billing_event(trial, event(FakeBillingEventKind.PAYMENT_SUCCEEDED, org="tenant-b"))


def test_fake_subscription_rejects_duplicate_trial():
    trial = apply_fake_billing_event(None, event(FakeBillingEventKind.TRIAL_ACTIVATED), initial_price=PRICE)
    with pytest.raises(ValueError):
        apply_fake_billing_event(trial, event(FakeBillingEventKind.TRIAL_ACTIVATED))


def test_fake_subscription_rejects_out_of_order_event():
    trial = apply_fake_billing_event(None, event(FakeBillingEventKind.TRIAL_ACTIVATED), initial_price=PRICE)
    with pytest.raises(ValueError):
        apply_fake_billing_event(trial, event(FakeBillingEventKind.PAYMENT_SUCCEEDED, at=NOW - timedelta(seconds=1)))


def test_fake_subscription_cannot_start_with_payment():
    with pytest.raises(ValueError):
        apply_fake_billing_event(None, event(FakeBillingEventKind.PAYMENT_SUCCEEDED), initial_price=PRICE)


@pytest.mark.parametrize("value", ["", None])
def test_fake_event_identity_required(value):
    with pytest.raises(ValueError):
        FakeBillingEvent(value, "tenant-a", FakeBillingEventKind.TRIAL_ACTIVATED, NOW)


class _MissingOffset(tzinfo):
    def utcoffset(self, dt):
        return None

    def dst(self, dt):
        return None

    def tzname(self, dt):
        return "unknown"


def test_fake_event_rejects_timezone_without_offset():
    timestamp = datetime(2026, 11, 17, tzinfo=_MissingOffset())
    with pytest.raises(ValueError, match="timezone aware"):
        FakeBillingEvent("event-1", "tenant-a", FakeBillingEventKind.TRIAL_ACTIVATED, timestamp)
