"""Answer a real telephone call only with a live phone token (launch gate, ADR-0006 §7).

The API refuses live tokens for countries that have not passed launch review, and refuses phone
tokens in test mode. This guard closes the remaining gap on the worker side: test tokens exist for
simulated calls, so a worker holding one must never answer a caller who dialled in from the phone
network. LiveKit marks those callers as SIP participants.
"""

from __future__ import annotations

import base64
import binascii
import json

SIP_KIND = 3  # livekit.rtc.ParticipantKind.PARTICIPANT_KIND_SIP


def claims(token: str) -> dict:
    """The token's payload, unverified (the API verifies the signature on every request)."""
    try:
        part = token.split(".")[1]
        value = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return value if isinstance(value, dict) else {}
    except (IndexError, ValueError, TypeError, binascii.Error):
        return {}


def is_phone(participant: object) -> bool:
    return getattr(participant, "kind", None) == SIP_KIND


def refusal(participant: object, token: str) -> str | None:
    """Why this worker must not answer this participant, or None if it may."""
    c = claims(token)
    if is_phone(participant):
        if c.get("mode") != "live" or c.get("channel") != "phone":
            return "a telephone caller needs a live phone token"
    elif c.get("channel") == "phone":
        return "a phone token cannot serve a non-SIP participant"
    return None


class CallBoundTokens:
    """Recheck the physical call channel on EVERY token fetch and refresh.

    A long call refreshes tokens. If the supervisor supplies a test token mid-call, it
    must not let a SIP call continue through the simulated-only API path.
    These claims are only a preliminary local check: the API authenticates them.
    """

    def __init__(self, source: object, participant: object) -> None:
        self.source = source
        self.participant = participant

    def _check(self, token: str) -> str:
        reason = refusal(self.participant, token)
        if reason is not None:
            raise RuntimeError(reason)
        return token

    async def get(self) -> str:
        return self._check(await self.source.get())

    async def refresh(self, stale: str | None = None) -> str:
        return self._check(await self.source.refresh(stale=stale))


def may_answer(participant: object, record_id: str | None) -> bool:
    """SIP requires successful API-authorized call creation before any speech.

    The API verifies JWT signature, country launch gate and channel. For browser
    simulations, call recording stays best effort (a record may be absent).
    """
    return not is_phone(participant) or bool(record_id)
