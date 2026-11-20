"""Read-only tenant billing dashboard projection.

This projection is for the isolated billing preview. It never creates charges,
changes entitlements, or exposes payment-provider credentials.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import text


@dataclass(frozen=True)
class BillingOverview:
    organization_id: str
    state: str | None
    price_code: str | None
    currency: str | None
    price_minor_units: int | None
    quota_limit: int | None
    quota_consumed: int | None
    quota_reserved: int | None
    quota_available: int | None
    synthetic_usage_events: int


def read_billing_overview(conn, *, organization_id: str, period_key: str) -> BillingOverview:
    """Return a tenant-only snapshot; no subscription is represented as inactive."""
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != organization_id:
        raise PermissionError("Billing overview tenant must match authenticated transaction")
    try:
        year_text, month_text = period_key.split("-")
        if len(year_text) != 4 or len(month_text) != 2 or not year_text.isascii() or not month_text.isascii():
            raise ValueError("Invalid billing period")
        year, month = int(year_text), int(month_text)
        start = datetime(year, month, 1, tzinfo=UTC)
        end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
    except (ValueError, OverflowError) as exc:
        raise ValueError("Invalid billing period") from exc
    subscription = (
        conn.execute(
            text(
                "SELECT state, price_code, currency, price_minor_units FROM billing_subscriptions "
                "WHERE organization_id = :org"
            ),
            {"org": organization_id},
        )
        .mappings()
        .one_or_none()
    )
    quota = (
        conn.execute(
            text(
                "SELECT limit_units, consumed_units, reserved_units FROM billing_quota_periods "
                "WHERE organization_id = :org AND period_key = :period"
            ),
            {"org": organization_id, "period": period_key},
        )
        .mappings()
        .one_or_none()
    )
    count = conn.execute(
        text(
            "SELECT count(*) FROM billing_usage_events "
            "WHERE organization_id = :org AND synthetic = true "
            "AND occurred_at >= :start AND occurred_at < :end"
        ),
        {"org": organization_id, "start": start, "end": end},
    ).scalar_one()
    return BillingOverview(
        organization_id=organization_id,
        state=subscription["state"] if subscription else None,
        price_code=subscription["price_code"] if subscription else None,
        currency=subscription["currency"] if subscription else None,
        price_minor_units=subscription["price_minor_units"] if subscription else None,
        quota_limit=quota["limit_units"] if quota else None,
        quota_consumed=quota["consumed_units"] if quota else None,
        quota_reserved=quota["reserved_units"] if quota else None,
        quota_available=(quota["limit_units"] - quota["consumed_units"] - quota["reserved_units"] if quota else None),
        synthetic_usage_events=count,
    )
