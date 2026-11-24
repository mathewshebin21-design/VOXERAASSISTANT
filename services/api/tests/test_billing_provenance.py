"""Pure tests for server-derived usage provenance; no live provider connections."""

import pytest

from app.billing_provenance import TrustedUsageContext, UsageOrigin, derive_usage_event
from app.billing_usage import UsageKind


def test_synthetic_harness_context_is_never_billable():
    ctx = TrustedUsageContext("tenant-a", "fake", UsageOrigin.SYNTHETIC_HARNESS, True)
    event = derive_usage_event(ctx, source_event_id="test-1", kind=UsageKind.CALL_SECOND, units=60)
    assert event.synthetic is True
    assert event.billable_units == 0
    assert event.organization_id == "tenant-a"


def test_verified_provider_context_derives_real_usage():
    ctx = TrustedUsageContext("tenant-b", "verified", UsageOrigin.VERIFIED_PROVIDER, True)
    event = derive_usage_event(ctx, source_event_id="provider-1", kind=UsageKind.STT_SECOND, units=30)
    assert event.synthetic is False
    assert event.billable_units == 30
    assert event.provider == "verified"


@pytest.mark.parametrize("authenticated", [False, 0, 1, "true", None])
def test_untrusted_or_malformed_authentication_rejected(authenticated):
    with pytest.raises(PermissionError):
        TrustedUsageContext("tenant-a", "fake", UsageOrigin.SYNTHETIC_HARNESS, authenticated)


def test_unknown_origin_rejected():
    with pytest.raises(ValueError):
        TrustedUsageContext("tenant-a", "fake", "client_claimed", True)


@pytest.mark.parametrize("tenant,provider", [("", "fake"), ("tenant-a", "")])
def test_missing_trusted_identity_rejected(tenant, provider):
    with pytest.raises(ValueError):
        TrustedUsageContext(tenant, provider, UsageOrigin.SYNTHETIC_HARNESS, True)
