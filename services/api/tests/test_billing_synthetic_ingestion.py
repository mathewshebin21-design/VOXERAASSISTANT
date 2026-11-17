"""Disposable PostgreSQL acceptance for signed synthetic billing ingestion."""

import hashlib
import hmac
import json

import pytest
from sqlalchemy import text

from app.billing_provenance import TrustedUsageContext, UsageOrigin
from app.billing_provider_replay import ProviderReplayConflict
from app.billing_synthetic_ingestion import ingest_signed_synthetic_usage
from app.billing_synthetic_signature import SyntheticSignatureError

SECRET = b"synthetic-only-testing-secret-key-32bytes-long"
NOW = 1794916800


def _body(units=60, *, event_id="signed-1"):
    return json.dumps(
        {"event_id": event_id, "kind": "call_second", "units": units, "occurred_at": "2026-11-17T12:00:00+00:00"}
    ).encode()


def _submit(conn, ctx, body, *, secret=SECRET, signature=None):
    signed = signature or hmac.new(secret, str(NOW).encode() + b"." + body, hashlib.sha256).hexdigest()
    return ingest_signed_synthetic_usage(
        conn, context=ctx, raw_body=body, timestamp=NOW, signature_hex=signed, shared_secret=SECRET, now=NOW
    )


def test_signed_synthetic_ingestion_is_atomic_and_idempotent(make_account, app_engine):
    a = make_account("billing-signed-atomic@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert _submit(conn, ctx, _body()) is True
        assert _submit(conn, ctx, _body()) is False
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 1
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 1
        assert conn.execute(text("SELECT synthetic FROM billing_usage_events")).scalar_one() is True


def test_signed_synthetic_ingestion_rejects_conflicting_replay(make_account, app_engine):
    a = make_account("billing-signed-conflict@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert _submit(conn, ctx, _body()) is True
        with pytest.raises(ProviderReplayConflict):
            _submit(conn, ctx, _body(61))


def test_signed_synthetic_ingestion_rejects_tampering(make_account, app_engine):
    a = make_account("billing-signed-tamper@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    good = _body()
    signed = hmac.new(SECRET, str(NOW).encode() + b"." + good, hashlib.sha256).hexdigest()
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(SyntheticSignatureError):
            _submit(conn, ctx, _body(61), signature=signed)
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0


def test_signed_synthetic_ingestion_rejects_foreign_tenant(make_account, app_engine):
    a = make_account("billing-signed-tenant-a@example.com")
    b = make_account("billing-signed-tenant-b@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        with pytest.raises(PermissionError):
            _submit(conn, ctx, _body())


def test_verified_provider_origin_cannot_enter_synthetic_path(make_account, app_engine):
    a = make_account("billing-signed-real-denied@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.VERIFIED_PROVIDER, True)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(PermissionError):
            _submit(conn, ctx, _body())


@pytest.mark.parametrize(
    "payload",
    [
        {"event_id": "x", "kind": "call_second", "units": 1, "occurred_at": "2026-11-17T12:00:00"},
        {"event_id": "x", "kind": "call_second", "units": True, "occurred_at": "2026-11-17T12:00:00+00:00"},
        {"event_id": "x", "kind": "call_second", "units": 1, "occurred_at": "2026-11-17T12:00:00+00:00", "synthetic": False},
    ],
)
def test_untrusted_or_invalid_payload_is_rejected(make_account, app_engine, payload):
    a = make_account("billing-signed-malformed@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(ValueError):
            _submit(conn, ctx, json.dumps(payload).encode())


def test_signed_synthetic_ingestion_rejects_duplicate_json_keys(make_account, app_engine):
    a = make_account("billing-signed-duplicate@example.com")
    ctx = TrustedUsageContext(a.org_id, "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    duplicate = _body().replace(b'"units": 60', b'"units": 60, "units": 60')
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(ValueError, match="Duplicate synthetic usage JSON field"):
            _submit(conn, ctx, duplicate)
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0
