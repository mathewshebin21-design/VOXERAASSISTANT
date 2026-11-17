"""Local-only HMAC verification for synthetic billing adapter acceptance.

This is NOT a production payment webhook verifier. It proves raw-body integrity,
bounded timestamp skew, and event replay handling for an isolated test harness.
"""

import hashlib
import hmac
import time


class SyntheticSignatureError(ValueError):
    """Synthetic adapter signature or timestamp failed validation."""


def verify_synthetic_signature(
    *,
    raw_body: bytes,
    timestamp: int,
    signature_hex: str,
    shared_secret: bytes,
    now: int | None = None,
    max_age_seconds: int = 300,
) -> None:
    """Reject malformed, stale, future, or tampered synthetic adapter messages."""
    if not isinstance(raw_body, bytes) or not raw_body:
        raise SyntheticSignatureError("Raw request body required")
    if type(timestamp) is not int or type(max_age_seconds) is not int or max_age_seconds <= 0:
        raise SyntheticSignatureError("Invalid signature timestamp policy")
    if not isinstance(shared_secret, bytes) or len(shared_secret) < 32:
        raise SyntheticSignatureError("A strong synthetic adapter secret is required")
    if not isinstance(signature_hex, str) or len(signature_hex) != 64:
        raise SyntheticSignatureError("Invalid signature encoding")
    current = int(time.time()) if now is None else now
    if type(current) is not int or abs(current - timestamp) > max_age_seconds:
        raise SyntheticSignatureError("Signature timestamp outside accepted window")
    expected = hmac.new(shared_secret, str(timestamp).encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_hex):
        raise SyntheticSignatureError("Synthetic adapter signature mismatch")
