"""Disposable PostgreSQL acceptance for atomic quota reservations."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
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


def test_quota_period_replay_preserves_limit_and_rejects_a_changed_limit(make_account, app_engine):
    a = make_account("quota-storage-period-replay@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        assert not create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        with pytest.raises(ValueError, match="Conflicting quota period replay"):
            create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=200)
        assert conn.execute(text("SELECT limit_units FROM billing_quota_periods")).scalar_one() == 100


@pytest.mark.parametrize("invalid_units", [True, 1.0, Decimal("1")])
def test_quota_settlement_replay_rejects_noninteger_equal_values(make_account, app_engine, invalid_units):
    a = make_account("quota-storage-settlement-types@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=60)
        settle_reserved_quota(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=1
        )
        with pytest.raises(ValueError, match="Settlement units must be nonnegative integers"):
            settle_reserved_quota(
                conn,
                organization_id=a.org_id,
                period_key="2026-11",
                reservation_id="call-1",
                consumed_units=invalid_units,
            )
        assert conn.execute(text("SELECT consumed_units, reserved_units FROM billing_quota_periods")).one() == (1, 0)
        assert not settle_reserved_quota(
            conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=1
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


def test_concurrent_period_creation_rejects_conflicting_limits(make_account, app_engine):
    a = make_account("quota-storage-period-race@example.com")
    barrier = Barrier(2, timeout=15)

    def submit(limit):
        with app_engine.begin() as conn:
            _tenant(conn, a.org_id)
            barrier.wait()
            return create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=limit)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit, limit) for limit in (100, 200)]
        results = []
        for future in futures:
            try:
                results.append(future.result(timeout=25))
            except ValueError as exc:
                assert str(exc) == "Conflicting quota period replay"
                results.append("conflict")
    assert sorted(results, key=str) == sorted([True, "conflict"], key=str)
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        assert conn.execute(text("SELECT count(*) FROM billing_quota_periods")).scalar_one() == 1
        assert conn.execute(text("SELECT limit_units FROM billing_quota_periods")).scalar_one() in (100, 200)


def test_concurrent_settlement_retries_are_idempotent(make_account, app_engine):
    a = make_account("quota-storage-settlement-race@example.com")
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        create_quota_period(conn, organization_id=a.org_id, period_key="2026-11", limit_units=100)
        reserve_quota_units(conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", units=60)
    barrier = Barrier(2, timeout=15)

    def submit():
        with app_engine.begin() as conn:
            _tenant(conn, a.org_id)
            barrier.wait()
            return settle_reserved_quota(
                conn, organization_id=a.org_id, period_key="2026-11", reservation_id="call-1", consumed_units=25
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit) for _ in range(2)]
        assert sorted(future.result(timeout=25) for future in futures) == [False, True]
    with app_engine.begin() as conn:
        _tenant(conn, a.org_id)
        balances = conn.execute(text("SELECT consumed_units, reserved_units FROM billing_quota_periods")).one()
        assert balances == (25, 0)
