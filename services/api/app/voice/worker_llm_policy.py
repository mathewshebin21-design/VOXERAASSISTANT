"""Fail-closed, per-turn LLM admission for the scoped voice worker.

An API reservation limits tokens, not money, and a configured provider key is NOT
permission for a workspace to use that provider. Every worker brain turn must
check the exact runtime model and its reviewed processing-region, price and
language evidence against the tenant's saved voice policy before reserving tokens.

No real provider/model is approved by default. Add any verified binding to
REVIEWED_MODELS only through a separate reviewed source change with evidence.
The gate is independent of worker mode: a 'test' token cannot bypass it.
The customer-facing voice lab uses separate, existing budget controls.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from .routing import VoicePolicy

ALLOWED_REGIONS = frozenset({"device", "uk", "eu", "us", "global"})
EVIDENCE = frozenset({"tested", "advertised", "unverified"})
PROVIDER_IDS = {
    "anthropic": "anthropic",
    "groq": "openai-compatible",
    "gemini": "openai-compatible",
    "openrouter": "openai-compatible",
    "ollama": "openai-compatible",
    "openai_compatible": "openai-compatible",
}


class ProviderAdmissionError(Exception):
    """A worker request cannot use the configured model under this workspace policy."""


@dataclass(frozen=True)
class ReviewedLLM:
    """Verified binding for one exact provider/model pair, never provided by a caller."""

    configured_provider: str
    model: str
    workspace_provider: str
    processing_regions: frozenset[str]
    paid: bool
    languages: frozenset[str]
    evidence: str


# Empty on purpose. A test worker token is NOT a way to authorize a real LLM.
REVIEWED_MODELS: Mapping[tuple[str, str], ReviewedLLM] = MappingProxyType({})


def check_worker_model(
    policy: VoicePolicy,
    *,
    configured_provider: str,
    model: str | None,
    requested_language: str | None,
    reviewed: Mapping[tuple[str, str], ReviewedLLM] | None = None,
) -> str:
    """Return the approved locale or reject before any model spend/reservation.

    The workspace controls the allowed languages; a missing language selects its
    saved default, but an explicit unapproved language never silently falls back.
    All known processing regions must be allowed, not merely one possible region.
    """
    if reviewed is None:
        reviewed = REVIEWED_MODELS
    language = requested_language if requested_language is not None else policy.default_language
    if language not in policy.languages:
        raise ProviderAdmissionError("language is not enabled for this workspace")

    key = (configured_provider, model or "")
    attestation = reviewed.get(key)
    expected_provider = PROVIDER_IDS.get(configured_provider)
    if (
        attestation is None
        or not expected_provider
        or attestation.configured_provider != configured_provider
        or attestation.model != model
        or attestation.workspace_provider != expected_provider
    ):
        raise ProviderAdmissionError("exact model has not been approved")
    if attestation.workspace_provider in policy.blocked_providers:
        raise ProviderAdmissionError("provider is blocked by this workspace")
    if (
        not attestation.processing_regions
        or not attestation.processing_regions <= ALLOWED_REGIONS
        or not attestation.processing_regions <= policy.allowed_regions
    ):
        raise ProviderAdmissionError("model processing region is not approved")
    if type(attestation.paid) is not bool or (attestation.paid and not policy.allow_paid):
        raise ProviderAdmissionError("paid provider is not approved")
    if language not in attestation.languages:
        raise ProviderAdmissionError("model lacks approved language coverage")
    if attestation.evidence not in EVIDENCE or (
        attestation.evidence == "unverified" and not policy.allow_unverified
    ):
        raise ProviderAdmissionError("model language evidence is not approved")
    return language
