"""Read-only billing entitlement acceptance on disposable PostgreSQL."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.billing_entitlements import can_create_subscription_resource

NOW = datetime(2026, 11, 17, tzinfo=UTC)


def _insert(conn, org_id, state="trialing", effective_at=NOW):
    conn.execute(
        text(
            "INSERT INTO billing_subscriptions "
            "(id, organization_id, price_code, currency, price_minor_units, state, effective_at) "
            "VALUES (:id, :org, 'uk-basic-v1', 'GBP', 2900, :state, :at)"
        ),
        {"id": uuid.uuid4(), "org": org_id, "state": state, "at": effective_at},
    )


def test_missing_subscription_fails_closed(make_account, app_engine):
    a = make_account("billing-entitlement-missing@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert not can_create_subscription_resource(conn, organization_id=a.org_id, at=NOW)


@pytest.mark.parametrize("state,expected", [("trialing", True), ("active", True), ("past_due", False), ("paused", False), ("canceled", False), ("expired", False)])
def test_subscription_state_entitlements(make_account, app_engine, state, expected):
    a = make_account(f"billing-entitlement-{state}@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        _insert(conn, a.org_id, state)
        assert can_create_subscription_resource(conn, organization_id=a.org_id, at=NOW) is expected


def test_future_effective_subscription_fails_closed(make_account, app_engine):
    a = make_account("billing-entitlement-future@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        _insert(conn, a.org_id, effective_at=NOW + timedelta(days=1))
        assert not can_create_subscription_resource(conn, organization_id=a.org_id, at=NOW)


def test_missing_or_foreign_tenant_context_is_denied(make_account, app_engine):
    a = make_account("billing-entitlement-a@example.com")
    b = make_account("billing-entitlement-b@example.com")
    with app_engine.begin() as conn, pytest.raises(PermissionError):
        can_create_subscription_resource(conn, organization_id=a.org_id, at=NOW)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        with pytest.raises(PermissionError):
            can_create_subscription_resource(conn, organization_id=a.org_id, at=NOW)


def test_entitlement_rejects_naive_timestamp(make_account, app_engine):
    a = make_account("billing-entitlement-time@example.com")
    with app_engine.begin() as conn, pytest.raises(ValueError):
        can_create_subscription_resource(conn, organization_id=a.org_id, at=datetime(2026, 11, 17))
