"""Pure quota arithmetic tests; transactional storage acceptance remains required."""

import pytest

from app.billing_quota_policy import QuotaExceeded, QuotaSnapshot, reserve_quota, settle_quota


def test_reserve_exact_remaining_quota():
    snapshot = reserve_quota(QuotaSnapshot(100, 60, 10), 30)
    assert snapshot.available == 0
    assert snapshot.reserved == 40


def test_reservation_cannot_exceed_limit():
    with pytest.raises(QuotaExceeded):
        reserve_quota(QuotaSnapshot(100, 60, 10), 31)


def test_settlement_releases_unused_reservation():
    snapshot = settle_quota(QuotaSnapshot(100, 40, 30), reserved_units=30, consumed_units=12)
    assert snapshot == QuotaSnapshot(100, 52, 0)
    assert snapshot.available == 48


def test_zero_consumption_releases_all_reserved_units():
    assert settle_quota(QuotaSnapshot(50, 0, 20), reserved_units=20, consumed_units=0).available == 50


@pytest.mark.parametrize("units", [0, -1, 1.5, True, "10"])
def test_invalid_reservation_units_fail_closed(units):
    with pytest.raises(ValueError):
        reserve_quota(QuotaSnapshot(100, 0, 0), units)


@pytest.mark.parametrize(
    "reserved,consumed",
    [(0, 0), (11, 1), (10, 11), (10, -1), (True, 1), (10, 1.5)],
)
def test_invalid_settlement_fails_closed(reserved, consumed):
    with pytest.raises(ValueError):
        settle_quota(QuotaSnapshot(100, 0, 10), reserved_units=reserved, consumed_units=consumed)


@pytest.mark.parametrize("values", [(-1, 0, 0), (100, -1, 0), (100, 0, -1), (100, 60, 41), (True, 0, 0)])
def test_invalid_snapshot_rejected(values):
    with pytest.raises(ValueError):
        QuotaSnapshot(*values)
