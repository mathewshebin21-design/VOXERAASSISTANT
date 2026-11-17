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
