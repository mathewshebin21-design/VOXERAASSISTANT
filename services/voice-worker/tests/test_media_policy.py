"""Offline source-attested media policy checks: never contact LiveKit or paid providers."""

from dataclasses import replace

import httpx
import pytest

from voxera_worker.media import MediaSettings
from voxera_worker.media_policy import (
    APPROVED_MODELS,
    ModelAttestation,
    authorize_models,
    fetch_authorized_languages,
    parse_workspace_policy,
)
from voxera_worker.policy import PolicyUnavailable

MEDIA = MediaSettings("deepgram/nova-3:multi", "cartesia/sonic-3", "offline-voice-01")
POLICY = {
    "default_language": "en-GB",
    "languages": ["en-GB", "hi-IN"],
    "fallback_language": "en-GB",
    "allowed_regions": ["eu", "us"],
    "blocked_providers": [],
    "preferred_providers": [],
    "allow_paid": True,
    "allow_unverified": False,
}
# Unit-test-only hypothetical attestations: NONE exist in the actual runtime registry.
FAKE_ATTESTATIONS = {
    "deepgram/nova-3:multi": ModelAttestation(
        "stt", "deepgram", frozenset({"eu"}), True, frozenset({"en-GB", "hi-IN"}), "tested"
    ),
    "cartesia/sonic-3": ModelAttestation(
        "tts", "cartesia", frozenset({"eu"}), True, frozenset({"en-GB", "hi-IN"}), "advertised"
    ),
}


class Tokens:
    def __init__(self):
        self.renewals = 0

    async def get(self):
        return "worker-token-a"

    async def refresh(self, stale=None):
        self.renewals += 1
        return "worker-token-b"


def test_no_models_approved_in_runtime_even_when_media_switch_enabled():
    assert not APPROVED_MODELS
    policy = parse_workspace_policy(POLICY)
    with pytest.raises(PolicyUnavailable, match="no approved provider attestation"):
        authorize_models(policy, MEDIA)


def test_exact_reviewed_model_bindings_would_be_authorized_under_valid_policy():
    policy = parse_workspace_policy(POLICY)
    authorize_models(policy, MEDIA, FAKE_ATTESTATIONS)
    assert policy.ordered_languages == ("en-GB", "hi-IN")


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"allow_paid": False}, "paid"),
        ({"blocked_providers": ["deepgram"]}, "blocked"),
        ({"allowed_regions": ["device", "uk"]}, "region"),
        ({"languages": ["en-GB", "hi-IN", "ml-IN"]}, "language"),
    ],
)
def test_workspace_policy_denies_noncompliant_media(change, expected):
    policy = parse_workspace_policy({**POLICY, **change})
    with pytest.raises(PolicyUnavailable, match=expected):
        authorize_models(policy, MEDIA, FAKE_ATTESTATIONS)


def test_attestation_cannot_claim_a_different_underlying_provider():
    p = parse_workspace_policy(POLICY)
    forged = {
        **FAKE_ATTESTATIONS,
        MEDIA.stt_model: replace(FAKE_ATTESTATIONS[MEDIA.stt_model], provider="somewhere"),
    }
    with pytest.raises(PolicyUnavailable, match="attestation"):
        authorize_models(p, MEDIA, forged)


def test_unverified_language_evidence_requires_explicit_consent():
    p = parse_workspace_policy(POLICY)
    uncertain = {
        **FAKE_ATTESTATIONS,
        MEDIA.tts_model: replace(FAKE_ATTESTATIONS[MEDIA.tts_model], evidence="unverified"),
    }
    with pytest.raises(PolicyUnavailable, match="evidence"):
        authorize_models(p, MEDIA, uncertain)
    authorize_models(replace(p, allow_unverified=True), MEDIA, uncertain)


@pytest.mark.parametrize(
    "update",
    [
        {"allow_paid": "yes"},
        {"allow_unverified": None},
        {"blocked_providers": None},
        {"allowed_regions": ["unknown"]},
        {"allowed_regions": []},
        {"languages": ["en-GB", "en-GB"]},
        {"default_language": "fr-FR"},
        {"languages": []},
    ],
)
def test_missing_or_malformed_authoritative_policy_is_rejected(update):
    with pytest.raises(PolicyUnavailable, match="malformed"):
        parse_workspace_policy({**POLICY, **update})


async def test_one_policy_request_checks_actual_media_before_any_provider_session():
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.method, req.url.path, req.headers["authorization"]))
        return httpx.Response(200, json=POLICY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await fetch_authorized_languages(
            "http://isolated-api.test", Tokens(), MEDIA, client, FAKE_ATTESTATIONS
        )
    assert result == ("en-GB", ("en-GB", "hi-IN"))
    assert seen == [("GET", "/v1/worker/voice/policy", "Bearer worker-token-a")]


async def test_expired_worker_token_refreshes_once_without_media_activation():
    tokens = Tokens()

    def handler(req: httpx.Request):
        if req.headers["authorization"] == "Bearer worker-token-a":
            return httpx.Response(401)
        return httpx.Response(200, json=POLICY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await fetch_authorized_languages(
            "http://isolated-api.test", tokens, MEDIA, client, FAKE_ATTESTATIONS
        )
    assert result[0] == "en-GB"
    assert tokens.renewals == 1


async def test_missing_attestation_refuses_even_if_api_claims_policy_allows_paid():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=POLICY))) as c:
        with pytest.raises(PolicyUnavailable, match="attestation"):
            await fetch_authorized_languages("http://isolated-api.test", Tokens(), MEDIA, c)


async def test_unreachable_policy_refuses_and_never_leaks_tokens():
    async def unused():
        pass

    def unavailable(req):
        raise httpx.ConnectError("network unavailable")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as c:
        with pytest.raises(PolicyUnavailable) as raised:
            await fetch_authorized_languages("http://isolated-api.test", Tokens(), MEDIA, c)
    assert "worker-token" not in str(raised.value)
