"""Synthetic adapter signature acceptance; no live payment credentials."""

import hashlib
import hmac

import pytest

from app.billing_synthetic_signature import SyntheticSignatureError, verify_synthetic_signature

SECRET = b"local-acceptance-secret-32-bytes-minimum"
BODY = b'{"event_id":"fake-001","units":30}'
TIMESTAMP = 1800000000


def sign(body=BODY, timestamp=TIMESTAMP):
    return hmac.new(SECRET, str(timestamp).encode() + b"." + body, hashlib.sha256).hexdigest()


def verify(**overrides):
    fields = {
        "raw_body": BODY,
        "timestamp": TIMESTAMP,
        "signature_hex": sign(),
        "shared_secret": SECRET,
        "now": TIMESTAMP,
    }
    fields.update(overrides)
    return verify_synthetic_signature(**fields)


def test_valid_synthetic_signature():
    assert verify() is None


@pytest.mark.parametrize(
    "changes",
    [
        {"raw_body": b'{"event_id":"fake-001","units":31}'},
        {"timestamp": TIMESTAMP - 301},
        {"timestamp": TIMESTAMP + 301},
        {"signature_hex": "0" * 64},
        {"signature_hex": "invalid"},
        {"shared_secret": b"short"},
        {"raw_body": b""},
        {"timestamp": "1800000000"},
        {"max_age_seconds": 0},
    ],
)
def test_invalid_synthetic_signatures_fail_closed(changes):
    with pytest.raises(SyntheticSignatureError):
        verify(**changes)


def test_timestamp_and_raw_body_are_cryptographically_bound():
    altered_time = TIMESTAMP + 1
    with pytest.raises(SyntheticSignatureError):
        verify(timestamp=altered_time)
    assert verify(timestamp=altered_time, signature_hex=sign(timestamp=altered_time)) is None


@pytest.mark.parametrize("delta", [-300, 300])
def test_timestamp_window_includes_exact_boundaries(delta):
    event_timestamp = TIMESTAMP + delta
    verify(timestamp=event_timestamp, signature_hex=sign(timestamp=event_timestamp))


@pytest.mark.parametrize("delta", [-301, 301])
def test_timestamp_window_excludes_first_outside_second(delta):
    event_timestamp = TIMESTAMP + delta
    with pytest.raises(SyntheticSignatureError, match="outside accepted window"):
        verify(timestamp=event_timestamp, signature_hex=sign(timestamp=event_timestamp))


@pytest.mark.parametrize("invalid_now", [True, False, "1800000000", 1800000000.0])
def test_invalid_or_untrusted_clock_inputs_fail_closed(invalid_now):
    with pytest.raises(SyntheticSignatureError, match="outside accepted window"):
        verify(now=invalid_now)


@pytest.mark.parametrize("invalid_policy", [True, False, -1, 0, 0.5, "300"])
def test_invalid_timestamp_policy_types_fail_closed(invalid_policy):
    with pytest.raises(SyntheticSignatureError, match="Invalid signature timestamp policy"):
        verify(max_age_seconds=invalid_policy)


def test_empty_or_non_bytes_raw_payload_fails_closed():
    for payload in ("not bytes", bytearray(BODY), b""):
        with pytest.raises(SyntheticSignatureError, match="Raw request body required"):
            verify(raw_body=payload)
