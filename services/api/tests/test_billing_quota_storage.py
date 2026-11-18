"""Disposable PostgreSQL acceptance for atomic quota reservations."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text

from app.billing_quota_policy import QuotaExceeded
from app.billing_quota_storage import create_quota_period, reserve_quota_units, settle_reserved_quota


def _tenant(conn, org):
    conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": org})


def test_quota_reservation_and_settlement_idempotent(make_account, app_engine):
    a = make_account("quota-storage-basic@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        assert reserve_quota_units(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=60
        )
        assert not reserve_quota_units(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=60
        )
        assert settle_reserved_quota(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=25
        )
        assert not settle_reserved_quota(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=25
        )
        assert conn.execute(
            text("SELECT consumed_units, reserved_units FROM billing_quota_periods WHERE organization_id = :org"),
            {"org": a.org_id},
        ).one() == (25, 0)


def test_quota_conflicting_replay_and_overuse_denied(make_account, app_engine):
    a = make_account("quota-storage-conflict@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=60)
        with pytest.raises(ValueError):
            reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=61)
        with pytest.raises(QuotaExceeded):
            reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-2", units=41)
        settle_reserved_quota(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=25
        )
        with pytest.raises(ValueError):
            settle_reserved_quota(
                conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=26
            )


def test_quota_tenant_isolation(make_account, app_engine):
    a = make_account("quota-storage-tenant-a@example.com")
    b = make_account("quota-storage-tenant-b@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
    with app_engine.begin() as conn:
        _tenant(conn, b.org_id)
        assert conn.execute(text("SELECT count(*) FROM billing_quota_periods")).scalar_one() == 0
        with pytest.raises(PermissionError):
            reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="foreign", units=1)


def test_concurrent_reservations_cannot_overallocate(make_account, app_engine):
    a = make_account("quota-storage-concurrent@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
    barrier = Barrier(2, timeout=15)

    def submit(reservation):
        with app_engine.begin() as conn:
            _tenant(conn, a.org_id)
            barrier.wait()
            return reserve_quota_units(
                conn, organization_id=a.org_id, period_key="2026-11", reservation_id=reservation, units=60
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit, reservation) for reservation in ("a", "b")]
        results = []
        for future in futures:
            try:
                results.append(future.result(timeout=25))
            except QuotaExceeded:
                results.append("exceeded")
        assert sorted(results, key=str) == sorted([True, "exceeded"], key=str)
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert conn.execute(text("SELECT reserved_units FROM billing_quota_periods")).scalar_one() == 60
