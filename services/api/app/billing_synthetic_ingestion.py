"""Verified synthetic billing ingestion for an isolated, non-public test harness.

The caller must supply a trusted server-side tenant context and set app.org_id.
Never expose this function as a public payment or phone webhook endpoint.
"""

import json
from datetime import UTC, datetime

from app.billing_provenance import TrustedUsageContext, UsageOrigin, derive_usage_event
from app.billing_provider_inbox import record_synthetic_provider_event
from app.billing_storage import record_synthetic_usage
from app.billing_synthetic_signature import verify_synthetic_signature
from app.billing_usage import UsageKind


def _unique_json_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate synthetic usage JSON field")
        result[key] = value
    return result


def ingest_signed_synthetic_usage(
    conn,
    *,
    context: TrustedUsageContext,
    raw_body: bytes,
    timestamp: int,
    signature_hex: str,
    shared_secret: bytes,
    now: int | None = None,
) -> bool:
    """Verify, parse, and persist a synthetic event and its inbox identity atomically.

    Returns True on first accepted usage, False for an identical replay.
    The caller must commit the transaction only after this function succeeds.
    """
    if context.origin is not UsageOrigin.SYNTHETIC_HARNESS or not context.authenticated:
        raise PermissionError("Synthetic harness origin required")
    verify_synthetic_signature(
        raw_body=raw_body,
        timestamp=timestamp,
        signature_hex=signature_hex,
        shared_secret=shared_secret,
        now=now,
    )
    try:
        payload = json.loads(raw_body, object_pairs_hook=_unique_json_fields)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid synthetic usage JSON") from exc
    if not isinstance(payload, dict) or set(payload) != {"event_id", "kind", "units", "occurred_at"}:
        raise ValueError("Unexpected synthetic usage payload shape")
    event_id = payload["event_id"]
    if not isinstance(event_id, str) or not event_id:
        raise ValueError("Synthetic event ID required")
    try:
        kind = UsageKind(payload["kind"])
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid synthetic usage kind") from exc
    units = payload["units"]
    if type(units) is not int or units <= 0:
        raise ValueError("Synthetic usage units must be positive integers")
    try:
        occurred = datetime.fromisoformat(payload["occurred_at"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid synthetic occurrence timestamp") from exc
    if occurred.tzinfo is None or occurred.utcoffset() is None:
        raise ValueError("Synthetic occurrence timestamp must be timezone aware")
    occurred = occurred.astimezone(UTC)
    event = derive_usage_event(context, source_event_id=event_id, kind=kind, units=units)
    record_synthetic_provider_event(
        conn,
        organization_id=context.organization_id,
        provider=context.provider,
        provider_event_id=event_id,
        raw_body=raw_body,
    )
    return record_synthetic_usage(conn, event, occurred_at=occurred)
