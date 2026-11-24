"""Provider replay digest contract tests; no external payment transport."""

import pytest

from app.billing_provider_replay import (
    ProviderReplayConflict,
    raw_event_digest,
    reconcile_provider_digest,
)


def test_identical_raw_provider_event_replay():
    body = b'{"event":"evt-1","amount":2900}'
    assert reconcile_provider_digest(raw_event_digest(body), body) is False


def test_changed_provider_event_payload_conflicts():
    body = b'{"event":"evt-1","amount":2900}'
    with pytest.raises(ProviderReplayConflict):
        reconcile_provider_digest(raw_event_digest(body), b'{"event":"evt-1","amount":3900}')


def test_raw_body_byte_identity_is_preserved():
    body = b'{"event":"evt-1","amount":2900}'
    reformatted = b'{"amount":2900,"event":"evt-1"}'
    assert raw_event_digest(body) != raw_event_digest(reformatted)


@pytest.mark.parametrize("body", [b"", None, "text", {}, False])
def test_invalid_raw_body_is_rejected(body):
    with pytest.raises(ValueError):
        raw_event_digest(body)


@pytest.mark.parametrize("digest", ["", "invalid", None])
def test_invalid_stored_digest_is_rejected(digest):
    with pytest.raises(ValueError):
        reconcile_provider_digest(digest, b"event")
