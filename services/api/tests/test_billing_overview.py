"""PostgreSQL acceptance for read-only billing dashboard projection."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.billing_overview import read_billing_overview
from app.billing_quota_storage import create_quota_period, reserve_quota_units


def _tenant(conn, org):
    conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": org})


def test_billing_overview_missing_subscription_and_quota(make_account, app_engine):
    a = make_account("billing-overview-empty@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        result = read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")
        assert result.state is None
        assert result.quota_available is None
        assert result.synthetic_usage_events == 0


def test_billing_overview_reports_reserved_capacity(make_account, app_engine):
    a = make_account("billing-overview-quota@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=30)
        result = read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")
        assert (result.quota_limit, result.quota_reserved, result.quota_available) == (100, 30, 70)


def test_billing_overview_cross_tenant_rejected(make_account, app_engine):
    a = make_account("billing-overview-a@example.com")
    b = make_account("billing-overview-b@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, b.org_id)
        with pytest.raises(PermissionError):
            read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")


def test_billing_overview_usage_count_is_month_scoped(make_account, app_engine):
    a = make_account("billing-overview-month@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        for event_id, occurred in (
            ("nov", datetime(2026, 11, 30, 23, 59, tzinfo=UTC)),
            ("dec", datetime(2026, 12, 1, 0, 0, tzinfo=UTC)),
        ):
            conn.execute(
                text(
                    "INSERT INTO billing_usage_events "
                    "(id, organization_id, provider, source_event_id, kind, units, synthetic, occurred_at) "
                    "VALUES (:id, :org, 'synthetic-test', :event, 'call_second', 1, true, :at)"
                ),
                {"id": uuid.uuid4(), "org": a.org_id, "event": event_id, "at": occurred},
            )
        nov = read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")
        dec = read_billing_overview(conn, organization_id=a.org_id, period_key="2026-12")
        assert nov.synthetic_usage_events == 1
        assert dec.synthetic_usage_events == 1


@pytest.mark.parametrize("period", ["2026-13", "2026-00", "2026-1", "garbage", "9999-12"])
def test_billing_overview_invalid_period_rejected(make_account, app_engine, period):
    a = make_account("billing-overview-invalid@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        with pytest.raises(ValueError, match="Invalid billing period"):
            read_billing_overview(conn, organization_id=a.org_id, period_key=period)
