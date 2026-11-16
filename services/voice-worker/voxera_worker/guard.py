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
from types import MappingProxyType

SIP_KIND = 3  # livekit.rtc.ParticipantKind.PARTICIPANT_KIND_SIP

# Source-reviewed LiveKit inbound trunk + dispatch rule -> allowed dialled numbers.
# There are deliberately NO approved routes. This is independent of the SIP flag,
# country launch signoffs, worker token, assigned-number check, and media policy.
# An operator must obtain separate infrastructure and commercial approval before
# any real tuple can be added; environment variables cannot expand this registry.
APPROVED_INBOUND_ROUTES = MappingProxyType({})
SIP_READY_STATES = frozenset({"ringing", "active"})


def sip_ingress_refusal(participant: object, dialed_number: str | None) -> str | None:
    """Reject unreviewed/outbound SIP routes before any provider, record, or media starts.

    LiveKit supplies these participant attributes; they are NOT by themselves
    cryptographic carrier attestations. The approved LiveKit server, inbound trunk
    authentication, dispatch configuration and carrier logs need separate review.
    Only the API's signature verification and assigned-number check prove the
    tenant authorization. Do not log call IDs or caller telephone numbers.
    """
    if not is_phone(participant):
        return "SIP origin verification requires a SIP participant"
    attrs = getattr(participant, "attributes", None)
    if not isinstance(attrs, dict):
        return "SIP attributes are unavailable"
    trunk = attrs.get("sip.trunkID")
    rule = attrs.get("sip.ruleID")
    if not isinstance(trunk, str) or not trunk or not isinstance(rule, str) or not rule:
        return "inbound SIP trunk or dispatch rule missing"
    if attrs.get("sip.callStatus") not in SIP_READY_STATES:
        return "SIP call is not ringing or active"
    for field in ("sip.callID", "sip.callIDFull"):
        value = attrs.get(field)
        if not isinstance(value, str) or not value.strip():
            return "SIP call identity is unavailable"
    allowed_numbers = APPROVED_INBOUND_ROUTES.get((trunk, rule), frozenset())
    if not dialed_number or dialed_number not in allowed_numbers:
        return "inbound SIP route and dialled number are not approved"
    return None


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


class ChannelMismatch(RuntimeError):
    """The worker's credential no longer matches the call's real channel (e.g. a test token handed
    to a telephone call mid-call). The call must end; it is never retried or treated as a glitch."""


class CallBoundTokens:
    """Recheck the physical call channel on EVERY token fetch and refresh.

    A long call refreshes tokens. If the supervisor supplies a test token mid-call, it
    must not let a SIP call continue through the simulated-only API path.
    These claims are only a preliminary local check: the API authenticates them.
    """

    def __init__(self, source: object, participant: object, call_ref: str | None = None) -> None:
        self.source = source
        self.participant = participant
        self.call_ref = call_ref

    def _check(self, token: str) -> str:
        reason = refusal(self.participant, token)
        if reason is not None:
            raise ChannelMismatch(reason)
        scoped_ref = claims(token).get("call_ref")
        if is_phone(self.participant) and (not self.call_ref or scoped_ref != self.call_ref):
            raise ChannelMismatch("telephone token is not bound to this call")
        if scoped_ref is not None and scoped_ref != self.call_ref:
            raise ChannelMismatch("worker token is bound to another call")
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
