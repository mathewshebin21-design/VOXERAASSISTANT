"""Answer a real telephone call only with a live phone token (launch gate, ADR-0006 §7).

The API refuses live tokens for countries that have not passed launch review, and refuses phone
tokens in test mode. This guard closes the remaining gap on the worker side: test tokens exist for
simulated calls, so a worker holding one must never answer a caller who dialled in from the phone
network. LiveKit marks those callers as SIP participants.
"""

from __future__ import annotations

import base64
import json

SIP_KIND = 3  # livekit.rtc.ParticipantKind.PARTICIPANT_KIND_SIP


def claims(token: str) -> dict:
    """The token's payload, unverified (the API verifies the signature on every request)."""
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (IndexError, ValueError):
        return {}


def is_phone(participant: object) -> bool:
    return getattr(participant, "kind", None) == SIP_KIND


def refusal(participant: object, token: str) -> str | None:
    """Why this worker must not answer this participant, or None if it may."""
    if not is_phone(participant):
        return None
    c = claims(token)
    if c.get("mode") != "live" or c.get("channel") != "phone":
        return "a telephone caller needs a live phone token; this worker holds a test token"
    return None
