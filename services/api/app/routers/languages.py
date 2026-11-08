"""Language registry and route preview (ADR-0006). Read-only: nothing is stored or called.

Saving a workspace's language policy needs a migration (approved separately); until then the route
preview takes the policy in the request, so the dashboard and the voice worker can use the same rules.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field

from ..config import get_settings
from ..deps import OrgContext, require
from ..live import providers as live_providers
from ..permissions import Perm
from ..schemas import Strict
from ..voice.languages import LANGUAGES, PROVIDERS, coverage
from ..voice.routing import NoCompliantRoute, VoicePolicy, select_route

router = APIRouter(prefix="/v1/orgs/{org_id}/voice", tags=["voice"])
Locale = Annotated[str, Field(pattern=r"^[a-z]{2,3}-[A-Z]{2}$")]
Region = Annotated[str, Field(pattern=r"^(device|uk|eu|us|global)$")]


def configured_providers() -> frozenset[str]:
    """Providers this deployment can use right now. Browser and on-device voices need no key."""
    s = get_settings()
    ids = {"browser-stt", "browser-tts", "kokoro"}
    if live_providers.llm_ready():
        ids.add("anthropic" if s.llm_provider == "anthropic" else "openai-compatible")
    if s.elevenlabs_api_key is not None and s.elevenlabs_voice_id:
        ids.add("elevenlabs")
    return frozenset(ids)


@router.get("/languages")
def list_languages(ctx: Annotated[OrgContext, Depends(require(Perm.read))]) -> dict:
    configured = configured_providers()
    return {
        "languages": coverage(),
        "providers": [
            {
                "id": p.id,
                "kind": p.kind.value,
                "name": p.name,
                "regions": sorted(p.regions),
                "streaming": p.streaming,
                "paid": p.paid,
                "integrated": p.integrated,
                "configured": p.id in configured,
                "languages": {k: v.value for k, v in p.languages.items()},
                "note": p.note,
            }
            for p in PROVIDERS.values()
            if not p.id.startswith("standin")
        ],
        "evidence_levels": {
            "tested": "VOXERA ran its own scenarios with recorded results",
            "advertised": "listed by the vendor; not verified by VOXERA",
            "unverified": "no vendor statement found; not routed unless explicitly allowed",
            "unsupported": "known not to work",
        },
    }


class RouteIn(Strict):
    language: Locale
    default_language: Locale = "en-GB"
    languages: list[Locale] = Field(default_factory=lambda: ["en-GB"], min_length=1, max_length=20)
    fallback_language: Locale | None = "en-GB"
    allowed_regions: list[Region] = Field(default_factory=lambda: ["device", "uk", "eu", "us", "global"])
    blocked_providers: list[str] = Field(default_factory=list, max_length=20)
    allow_paid: bool = False
    allow_unverified: bool = False


@router.post("/route")
def preview_route(body: RouteIn, ctx: Annotated[OrgContext, Depends(require(Perm.read))]) -> dict:
    """Which providers a call in this language would use under this policy, and why. Calls nothing."""
    unknown = {body.language, body.default_language, *body.languages} - LANGUAGES.keys()
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown language: {', '.join(sorted(unknown))}")
    try:
        policy = VoicePolicy(
            default_language=body.default_language,
            languages=tuple(body.languages),
            fallback_language=body.fallback_language,
            allowed_regions=frozenset(body.allowed_regions),
            blocked_providers=frozenset(body.blocked_providers),
            allow_paid=body.allow_paid,
            allow_unverified=body.allow_unverified,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    try:
        r = select_route(body.language, policy, configured_providers())
    except NoCompliantRoute as e:
        return {"routable": False, "language": body.language, "gaps": e.gaps}
    return {
        "routable": True,
        "language": r.language,
        "requested": r.requested,
        "language_fallback": r.language_fallback,
        "stt": r.stt,
        "llm": r.llm,
        "tts": r.tts,
        "evidence": dict(r.evidence),
        "reasons": list(r.reasons),
    }
