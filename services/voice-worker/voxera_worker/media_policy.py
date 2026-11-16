"""Fail-closed authorization for the worker's *actual* STT/TTS model selections.

The API's saved workspace policy is necessary but not sufficient: LiveKit inference model
names are deployment settings and have not been reviewed for processing regions, cost or
language performance. Until an operator reviews precise provider/model/region evidence
in source control, APPROVED_MODELS is intentionally empty. Enabling VOXERA_MEDIA_ENABLED
must not bypass workspace policy or silently authorize paid speech inference.

This protects STT/TTS admission only. LLM brain policy enforcement, provider metering,
real disclosures, and carrier acceptance are separate launch blockers.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

import httpx

from .media import MediaSettings
from .policy import LOCALE, PolicyUnavailable

REGIONS = frozenset({"device", "uk", "eu", "us", "global"})
EVIDENCE = frozenset({"tested", "advertised", "unverified"})


@dataclass(frozen=True)
class WorkspaceVoicePolicy:
    default_language: str
    languages: tuple[str, ...]
    allowed_regions: frozenset[str]
    blocked_providers: frozenset[str]
    allow_paid: bool
    allow_unverified: bool

    @property
    def ordered_languages(self) -> tuple[str, ...]:
        return (self.default_language, *(x for x in self.languages if x != self.default_language))


@dataclass(frozen=True)
class ModelAttestation:
    """Source-reviewed, exact LiveKit model identity. No environment-defined attestations."""

    kind: str
    provider: str
    processing_regions: frozenset[str]
    paid: bool
    languages: frozenset[str]
    evidence: str


# No real speech model has an approved binding yet. Add one only in a separately
# reviewed source change, backed by provider residency/pricing/language evidence.
APPROVED_MODELS: Mapping[str, ModelAttestation] = MappingProxyType({})


def parse_workspace_policy(body: object) -> WorkspaceVoicePolicy:
    if not isinstance(body, dict):
        raise PolicyUnavailable("voice policy malformed")
    default = body.get("default_language")
    languages = body.get("languages")
    regions = body.get("allowed_regions")
    blocked = body.get("blocked_providers")
    paid = body.get("allow_paid")
    unverified = body.get("allow_unverified")
    if not (
        isinstance(default, str)
        and LOCALE.fullmatch(default)
        and isinstance(languages, list)
        and languages
        and all(isinstance(lang, str) and LOCALE.fullmatch(lang) for lang in languages)
        and len(set(languages)) == len(languages)
        and default in languages
        and isinstance(regions, list)
        and bool(regions)
        and all(isinstance(region, str) and region in REGIONS for region in regions)
        and isinstance(blocked, list)
        and all(isinstance(provider, str) and provider for provider in blocked)
        and type(paid) is bool
        and type(unverified) is bool
    ):
        raise PolicyUnavailable("voice policy malformed")
    return WorkspaceVoicePolicy(
        default_language=default,
        languages=tuple(languages),
        allowed_regions=frozenset(regions),
        blocked_providers=frozenset(blocked),
        allow_paid=paid,
        allow_unverified=unverified,
    )


def authorize_models(
    policy: WorkspaceVoicePolicy,
    media: MediaSettings,
    attestations: Mapping[str, ModelAttestation] = APPROVED_MODELS,
) -> None:
    """Reject every unreviewed or noncompliant model before initializing STT/TTS."""
    for kind, model in (("stt", media.stt_model), ("tts", media.tts_model)):
        att = attestations.get(model)
        if att is None or att.kind != kind or not att.provider or model.split("/", 1)[0] != att.provider:
            raise PolicyUnavailable("speech model has no approved provider attestation")
        if (
            not att.processing_regions
            or not att.processing_regions <= REGIONS
            or not att.processing_regions <= policy.allowed_regions
        ):
            raise PolicyUnavailable("speech processing region is not authorized")
        if att.provider in policy.blocked_providers:
            raise PolicyUnavailable("speech provider is blocked by workspace")
        if type(att.paid) is not bool or (att.paid and not policy.allow_paid):
            raise PolicyUnavailable("paid speech provider is not authorized")
        if not att.languages or not set(policy.languages) <= att.languages:
            raise PolicyUnavailable("speech model lacks approved language coverage")
        if att.evidence not in EVIDENCE or (att.evidence == "unverified" and not policy.allow_unverified):
            raise PolicyUnavailable("speech language evidence is not authorized")


async def fetch_authorized_languages(
    api: str,
    tokens,
    media: MediaSettings,
    http: httpx.AsyncClient | None = None,
    attestations: Mapping[str, ModelAttestation] = APPROVED_MODELS,
) -> tuple[str, tuple[str, ...]]:
    """Read one tenant-scoped policy and authorize exact models; fail closed on any fault."""
    client = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
    try:
        token = await tokens.get()
        url = api.rstrip("/") + "/v1/worker/voice/policy"
        response = await client.get(url, headers={"authorization": "Bearer " + token})
        if response.status_code == 401:
            token = await tokens.refresh(stale=token)
            response = await client.get(url, headers={"authorization": "Bearer " + token})
        if response.status_code != 200:
            raise PolicyUnavailable(f"voice policy request refused ({response.status_code})")
        policy = parse_workspace_policy(response.json())
        authorize_models(policy, media, attestations)
        return policy.default_language, policy.ordered_languages
    except PolicyUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 - failed policy fetch always means no provider startup
        raise PolicyUnavailable(f"voice policy unavailable ({type(error).__name__})") from None
    finally:
        if http is None:
            await client.aclose()
