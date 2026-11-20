"""Read-only subscription entitlement evaluation; never enables media or telephony.

The authenticated caller must establish app.org_id on the transaction.
Missing, stale or invalid subscription records fail closed.
"""

from datetime import datetime

from sqlalchemy import text

from app.billing_policy import PriceVersion, Subscription, SubscriptionState, can_create_paid_resource


def can_create_subscription_resource(conn, *, organization_id: str, at: datetime) -> bool:
    """Read current tenant's subscription under RLS; no payment/provider side effects."""
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Entitlement timestamp must be timezone aware")
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != organization_id:
        raise PermissionError("Entitlement tenant must match authenticated transaction context")
    row = (
        conn.execute(
            text(
                "SELECT price_code, currency, price_minor_units, state, effective_at "
                "FROM billing_subscriptions WHERE organization_id = :org"
            ),
            {"org": organization_id},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return False
    subscription = Subscription(
        organization_id=organization_id,
        price=PriceVersion(row["price_code"], row["currency"], row["price_minor_units"]),
        state=SubscriptionState(row["state"]),
        effective_at=row["effective_at"],
    )
    return can_create_paid_resource(subscription, at=at)
