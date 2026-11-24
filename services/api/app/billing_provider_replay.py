"""Canonical raw-body digest for future verified provider inbox reconciliation.

A provider event ID alone cannot prove that a retry contains the same payload.
This pure helper does not authenticate a webhook or persist the digest.
"""

import hashlib


def raw_event_digest(raw_body: bytes) -> str:
    """Hash the exact received bytes; do not parse and reserialize JSON."""
    if not isinstance(raw_body, bytes) or not raw_body:
        raise ValueError("Non-empty raw event bytes required")
    return hashlib.sha256(raw_body).hexdigest()


class ProviderReplayConflict(ValueError):
    """A provider event identity was reused with a different raw payload."""


def reconcile_provider_digest(existing_digest: str, incoming_raw_body: bytes) -> bool:
    """Return False for an identical replay; reject changed payloads."""
    if not isinstance(existing_digest, str) or len(existing_digest) != 64:
        raise ValueError("Stored event digest is invalid")
    if existing_digest != raw_event_digest(incoming_raw_body):
        raise ProviderReplayConflict("Provider event identity reused with conflicting payload")
    return False
