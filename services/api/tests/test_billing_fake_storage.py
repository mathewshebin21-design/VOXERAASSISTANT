"""Disposable PostgreSQL fake subscription event acceptance."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.billing_fake_provider import FakeBillingEvent, FakeBillingEventKind
from app.billing_fake_storage import apply_fake_subscription_event
from app.billing_policy import PriceVersion
from app.billing_provider_replay import ProviderReplayConflict

NOW = datetime(2026, 11, 17, tzinfo=UTC)
PRICE = PriceVersion("uk-basic-v1", "GBP", 2900)


def _tenant(conn, org):
    conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": org})


def _event(org, kind, *, event_id, at=NOW):
    return FakeBillingEvent(event_id, org, kind, at)


def _apply(conn, event, *, raw=None, price=None):
    body = (
        raw
        if raw is not None
        else json.dumps(
            {
                "event_id": event.event_id,
                "organization_id": event.organization_id,
                "kind": event.kind.value,
                "occurred_at": event.occurred_at.isoformat(),
            },
            sort_keys=True,
        ).encode()
    )
    return apply_fake_subscription_event(conn, event=event, raw_body=body, initial_price=price)


def test_fake_subscription_durable_lifecycle_and_replay(make_account, app_engine):
    a = make_account("fake-storage-lifecycle@example.com")
    trial = _event(a.org_id, FakeBillingEventKind.TRIAL_ACTIVATED, event_id="trial")
    active = _event(a.org_id, FakeBillingEventKind.PAYMENT_SUCCEEDED, event_id="paid", at=NOW + timedelta(minutes=1))
    failed = _event(a.org_id, FakeBillingEventKind.PAYMENT_FAILED, event_id="failed", at=NOW + timedelta(minutes=2))
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert _apply(conn, trial, price=PRICE) is True
        assert _apply(conn, trial, price=PRICE) is False
        assert _apply(conn, active) is True
        assert _apply(conn, failed) is True
        assert (
            conn.execute(
                text("SELECT state FROM billing_subscriptions WHERE organization_id = :org"), {"org": a.org_id}
            ).scalar_one()
            == "past_due"
        )
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 3
        assert conn.execute(text("SELECT count(*) FROM billing_subscriptions")).scalar_one() == 1


def test_fake_subscription_rejects_changed_event_payload(make_account, app_engine):
    a = make_account("fake-storage-conflict@example.com")
    event = _event(a.org_id, FakeBillingEventKind.TRIAL_ACTIVATED, event_id="trial")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert _apply(conn, event, price=PRICE) is True
        with pytest.raises(ProviderReplayConflict):
            alternate = json.dumps(
                {
                    "event_id": event.event_id,
                    "organization_id": event.organization_id,
                    "kind": event.kind.value,
                    "occurred_at": event.occurred_at.isoformat(),
                },
                indent=2,
            ).encode()
            _apply(conn, event, raw=alternate, price=PRICE)


def test_fake_subscription_rejects_cross_tenant(make_account, app_engine):
    a = make_account("fake-storage-tenant-a@example.com")
    b = make_account("fake-storage-tenant-b@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, b.org_id)
        with pytest.raises(PermissionError):
            _apply(
                conn,
                _event(a.org_id, FakeBillingEventKind.TRIAL_ACTIVATED, event_id="trial"),
                price=PRICE,
            )


def test_fake_subscription_invalid_transition_rolls_back(make_account, app_engine):
    a = make_account("fake-storage-rollback@example.com")
    with pytest.raises(ValueError), app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        _apply(conn, _event(a.org_id, FakeBillingEventKind.PAYMENT_SUCCEEDED, event_id="invalid"))
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM billing_subscriptions")).scalar_one() == 0


def test_fake_subscription_rejects_envelope_identity_mismatch(make_account, app_engine):
    a = make_account("fake-storage-envelope@example.com")
    event = _event(a.org_id, FakeBillingEventKind.TRIAL_ACTIVATED, event_id="trial")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        with pytest.raises(ValueError, match="envelope"):
            _apply(conn, event, raw=b'{"event_id":"different"}', price=PRICE)
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0


def test_fake_subscription_rejects_duplicate_json_fields(make_account, app_engine):
    a = make_account("fake-storage-duplicate@example.com")
    event = _event(a.org_id, FakeBillingEventKind.TRIAL_ACTIVATED, event_id="trial")
    raw = json.dumps(
        {
            "event_id": event.event_id,
            "organization_id": event.organization_id,
            "kind": event.kind.value,
            "occurred_at": event.occurred_at.isoformat(),
        }
    ).encode()
    raw = raw.replace(b'"event_id": "trial"', b'"event_id": "trial", "event_id": "trial"')
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        with pytest.raises(ValueError, match="Duplicate fake event"):
            _apply(conn, event, raw=raw, price=PRICE)
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0
