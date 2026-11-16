"""No worker token mode may bypass the source-reviewed LLM admission gate.

Model attestations in this test are synthetic test-only values, not provider approval.
"""

from dataclasses import replace

import pytest

from app.voice.routing import VoicePolicy
from app.voice.worker_llm_policy import (
    REVIEWED_MODELS,
    ProviderAdmissionError,
    ReviewedLLM,
    check_worker_model,
)

MODEL = "offline-reviewed-test-model"
ATTESTED = ReviewedLLM(
    configured_provider="anthropic",
    model=MODEL,
    workspace_provider="anthropic",
    processing_regions=frozenset({"eu"}),
    paid=True,
    languages=frozenset({"en-GB", "hi-IN"}),
    evidence="advertised",
)
REVIEWED = {("anthropic", MODEL): ATTESTED}
POLICY = VoicePolicy(
    default_language="en-GB",
    languages=("en-GB", "hi-IN"),
    fallback_language="en-GB",
    allowed_regions=frozenset({"eu", "global"}),
    allow_paid=True,
)


def check(policy=POLICY, *, provider="anthropic", model=MODEL, language="en-GB", reviewed=REVIEWED):
    return check_worker_model(
        policy,
        configured_provider=provider,
        model=model,
        requested_language=language,
        reviewed=reviewed,
    )


def test_actual_runtime_has_no_provider_approval():
    assert not REVIEWED_MODELS
    with pytest.raises(ProviderAdmissionError, match="approved"):
        check(reviewed=REVIEWED_MODELS)


def test_exact_model_and_allowed_language_pass_only_under_explicit_test_attestation():
    assert check(language="hi-IN") == "hi-IN"
    assert check(language=None) == "en-GB"


@pytest.mark.parametrize(
    ("model", "provider"),
    [
        ("different-model", "anthropic"),
        (MODEL, "groq"),
        ("", "anthropic"),
    ],
)
def test_model_and_provider_identity_must_match(model, provider):
    with pytest.raises(ProviderAdmissionError, match="approved"):
        check(model=model, provider=provider)


@pytest.mark.parametrize(
    ("policy", "language", "reason"),
    [
        (replace(POLICY, allow_paid=False), "en-GB", "paid"),
        (replace(POLICY, blocked_providers=frozenset({"anthropic"})), "en-GB", "blocked"),
        (replace(POLICY, allowed_regions=frozenset({"uk"})), "en-GB", "region"),
        (POLICY, "ml-IN", "language"),
    ],
)
def test_policy_blocks_ineligible_call_before_inference(policy, language, reason):
    with pytest.raises(ProviderAdmissionError, match=reason):
        check(policy, language=language)


@pytest.mark.parametrize(
    ("binding", "reason"),
    [
        (replace(ATTESTED, workspace_provider="openai-compatible"), "approved"),
        (replace(ATTESTED, processing_regions=frozenset()), "region"),
        (replace(ATTESTED, processing_regions=frozenset({"eu", "us"})), "region"),
        (replace(ATTESTED, languages=frozenset({"en-GB"})), "language"),
        (replace(ATTESTED, evidence="unsupported"), "evidence"),
        (replace(ATTESTED, evidence="unverified"), "evidence"),
    ],
)
def test_attestation_gaps_fail_closed(binding, reason):
    with pytest.raises(ProviderAdmissionError, match=reason):
        check(language="hi-IN", reviewed={("anthropic", MODEL): binding})


def test_unverified_evidence_needs_workspace_consent():
    policy = replace(POLICY, allow_unverified=True)
    binding = replace(ATTESTED, evidence="unverified")
    assert check(policy, reviewed={("anthropic", MODEL): binding}) == "en-GB"


def test_runtime_attestation_provider_cannot_be_inferred_from_model_prefix():
    # Unlike LiveKit's prefixed speech models, OpenAI-compatible custom endpoints
    # may have arbitrary model names. A model string cannot authorize a provider.
    binding = replace(ATTESTED, configured_provider="openai_compatible", workspace_provider="openai-compatible")
    with pytest.raises(ProviderAdmissionError, match="approved"):
        check(reviewed={("anthropic", MODEL): binding})
