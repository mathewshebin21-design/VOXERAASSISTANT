"""Tenant-scoped atomic quota reservation storage for isolated billing acceptance.

All operations require a transaction with app.org_id set by authenticated code.
A single PostgreSQL row lock serializes competing reservations per tenant/period.
No payment, phone, or external provider is activated.
"""

import uuid
from sqlalchemy import text

from app.billing_quota_policy import QuotaSnapshot, reserve_quota, settle_quota


def _tenant(conn, organization_id: str) -> None:
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != organization_id:
        raise PermissionError("Quota tenant must match authenticated transaction context")


def _snapshot(conn, organization_id: str, period_key: str) -> QuotaSnapshot:
    row = conn.execute(
        text(
            "SELECT limit_units, consumed_units, reserved_units FROM billing_quota_periods "
            "WHERE organization_id = :org AND period_key = :period FOR UPDATE"
        ),
        {"org": organization_id, "period": period_key},
    ).mappings().one()
    return QuotaSnapshot(row["limit_units"], row["consumed_units"], row["reserved_units"])


def create_quota_period(
    conn, *, organization_id: str, period_key: str, limit_units: int
) -> bool:
    """Initialize an immutable period limit; never overwrite an existing limit."""
    _tenant(conn, organization_id)
    QuotaSnapshot(limit_units, 0, 0)
    if not period_key or len(period_key) > 64:
        raise ValueError("Invalid quota period")
    return conn.execute(
        text(
            "INSERT INTO billing_quota_periods (organization_id, period_key, limit_units) "
            "VALUES (:org, :period, :limit) ON CONFLICT (organization_id, period_key) DO NOTHING "
            "RETURNING organization_id"
        ),
        {"org": organization_id, "period": period_key, "limit": limit_units},
    ).scalar_one_or_none() is not None


def reserve_quota_units(
    conn,
    *,
    organization_id: str,
    period_key: str,
    reservation_id: str,
    units: int,
) -> bool:
    """Reserve units once, using row locking and immutable reservation IDs."""
    _tenant(conn, organization_id)
    if not reservation_id or len(reservation_id) > 160:
        raise ValueError("Invalid quota reservation identity")
    if type(units) is not int or units <= 0:
        raise ValueError("Reservation units must be positive integers")
    snapshot = _snapshot(conn, organization_id, period_key)
    existing = conn.execute(
        text(
            "SELECT units, consumed_units FROM billing_quota_reservations "
            "WHERE organization_id = :org AND period_key = :period AND reservation_id = :reservation"
        ),
        {"org": organization_id, "period": period_key, "reservation": reservation_id},
    ).mappings().one_or_none()
    if existing is not None:
        if existing["units"] != units:
            raise ValueError("Conflicting quota reservation replay")
        return False
    updated = reserve_quota(snapshot, units)
    conn.execute(
        text(
            "INSERT INTO billing_quota_reservations "
            "(id, organization_id, period_key, reservation_id, units) "
            "VALUES (:id, :org, :period, :reservation, :units)"
        ),
        {"id": uuid.uuid4(), "org": organization_id, "period": period_key, "reservation": reservation_id, "units": units},
    )
    conn.execute(
        text(
            "UPDATE billing_quota_periods SET reserved_units = :reserved "
            "WHERE organization_id = :org AND period_key = :period"
        ),
        {"reserved": updated.reserved, "org": organization_id, "period": period_key},
    )
    return True


def settle_reserved_quota(
    conn,
    *,
    organization_id: str,
    period_key: str,
    reservation_id: str,
    consumed_units: int,
) -> bool:
    """Settle exactly once, releasing unused units and rejecting changed replays."""
    _tenant(conn, organization_id)
    snapshot = _snapshot(conn, organization_id, period_key)
    row = conn.execute(
        text(
            "SELECT units, consumed_units FROM billing_quota_reservations "
            "WHERE organization_id = :org AND period_key = :period AND reservation_id = :reservation"
        ),
        {"org": organization_id, "period": period_key, "reservation": reservation_id},
    ).mappings().one()
    if row["consumed_units"] is not None:
        if row["consumed_units"] != consumed_units:
            raise ValueError("Conflicting quota settlement replay")
        return False
    updated = settle_quota(snapshot, reserved_units=row["units"], consumed_units=consumed_units)
    conn.execute(
        text(
            "UPDATE billing_quota_reservations SET consumed_units = :consumed, settled_at = now() "
            "WHERE organization_id = :org AND period_key = :period AND reservation_id = :reservation"
        ),
        {"consumed": consumed_units, "org": organization_id, "period": period_key, "reservation": reservation_id},
    )
    conn.execute(
        text(
            "UPDATE billing_quota_periods SET reserved_units = :reserved, consumed_units = :consumed "
            "WHERE organization_id = :org AND period_key = :period"
        ),
        {
            "reserved": updated.reserved,
            "consumed": updated.consumed,
            "org": organization_id,
            "period": period_key,
        },
    )
    return True
