"""Phase 11 usage validation, independent of payment providers."""

import pytest

from app.billing_usage import UsageEvent, UsageKind, UsageReplayConflict, reconcile_replay


def event(**overrides):
    fields = {
        "organization_id": "tenant-a",
        "source_event_id": "call-001",
        "kind": UsageKind.CALL_SECOND,
        "units": 60,
        "synthetic": False,
        "provider": "standin",
    }
    fields.update(overrides)
    return UsageEvent(**fields)


def test_real_usage_is_billable_in_native_units():
    assert event().billable_units == 60


def test_synthetic_usage_never_counts_toward_billing():
    assert event(synthetic=True).billable_units == 0


def test_deduplication_identity_is_tenant_and_provider_scoped():
    assert event().deduplication_key != event(organization_id="tenant-b").deduplication_key
    assert event().deduplication_key != event(provider="different").deduplication_key


@pytest.mark.parametrize("units", [0, -1, 1.2, True, "60"])
def test_invalid_units_are_rejected(units):
    with pytest.raises(ValueError):
        event(units=units)


@pytest.mark.parametrize("field", ["organization_id", "source_event_id", "provider"])
def test_required_provenance_is_rejected_when_missing(field):
    with pytest.raises(ValueError):
        event(**{field: ""})


def test_unrecognized_usage_kind_is_rejected():
    with pytest.raises(ValueError):
        event(kind="unrecognized")


def test_exact_usage_replay_is_noop():
    assert reconcile_replay(event(), event()) is False


@pytest.mark.parametrize("changed", [{"units": 61}, {"synthetic": True}, {"kind": UsageKind.STT_SECOND}])
def test_conflicting_usage_replay_is_rejected(changed):
    with pytest.raises(UsageReplayConflict):
        reconcile_replay(event(), event(**changed))


def test_unrelated_usage_identity_cannot_be_reconciled():
    with pytest.raises(ValueError):
        reconcile_replay(event(), event(source_event_id="call-002"))
