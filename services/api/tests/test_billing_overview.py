"""PostgreSQL acceptance for read-only billing dashboard projection."""

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
        reserve_quota_units(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=30
        )
        result = read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")
        assert (result.quota_limit, result.quota_reserved, result.quota_available) == (100, 30, 70)


def test_billing_overview_cross_tenant_rejected(make_account, app_engine):
    a = make_account("billing-overview-a@example.com")
    b = make_account("billing-overview-b@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, b.org_id)
        with pytest.raises(PermissionError):
            read_billing_overview(conn, organization_id=a.org_id, period_key="2026-11")
