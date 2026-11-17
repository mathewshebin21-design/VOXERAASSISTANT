"""Transactional provider inbox acceptance for verified, synthetic-only adapters.

Caller must authenticate the adapter and set app.org_id in the transaction.
This writer does not verify a signature, change subscriptions, or accept payments.
"""

import uuid

from sqlalchemy import text

from .billing_provider_replay import reconcile_provider_digest, raw_event_digest


def record_synthetic_provider_event(
    conn,
    *,
    organization_id: str,
    provider: str,
    provider_event_id: str,
    raw_body: bytes,
) -> bool:
    """Return True on first insert, False for identical retry; reject conflicts.

    A unique constraint serializes concurrent inserts with the same identity.
    Caller must verify the raw request signature BEFORE invoking this function.
    """
    if not organization_id or not provider or not provider_event_id:
        raise ValueError("Provider event identity must be complete")
    tenant = conn.execute(text("SELECT current_setting('app.org_id', true)")).scalar_one()
    if not tenant or tenant != organization_id:
        raise PermissionError("Provider inbox tenant must match authenticated context")
    digest = raw_event_digest(raw_body)
    inserted = conn.execute(
        text(
            "INSERT INTO billing_provider_inbox "
            "(id, organization_id, provider, provider_event_id, payload_sha256) "
            "VALUES (:id, :org, :provider, :event, :digest) "
            "ON CONFLICT (organization_id, provider, provider_event_id) DO NOTHING "
            "RETURNING id"
        ),
        {
            "id": uuid.uuid4(),
            "org": organization_id,
            "provider": provider,
            "event": provider_event_id,
            "digest": digest,
        },
    ).scalar_one_or_none()
    if inserted is not None:
        return True
    existing_digest = conn.execute(
        text(
            "SELECT payload_sha256 FROM billing_provider_inbox "
            "WHERE organization_id = :org AND provider = :provider AND provider_event_id = :event"
        ),
        {"org": organization_id, "provider": provider, "event": provider_event_id},
    ).scalar_one()
    reconcile_provider_digest(existing_digest, raw_body)
    return False
