"""Language registry, the workspace's saved voice policy and its telephone numbers (ADR-0006).

- ``GET/PUT /voice/policy``: the policy is stored per workspace (migration 0012). Everyone in the
  workspace may read it; owners and admins (``business_write``) may change it.
- ``GET /voice/numbers``: the numbers that reach this workspace. Read-only: an operator assigns
  numbers (``scripts/phone_numbers.py``), so no workspace can claim another business's number.
- ``POST /voice/route`` previews a route for a policy given in the request; ``GET /voice/route``
  uses the saved policy. Neither calls a provider or stores anything.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import Field

from .. import audit
from ..config import get_settings
from ..deps import DB, OrgContext, client_meta, require
from ..live import providers as live_providers
from ..models import VoicePolicyRow
from ..permissions import Perm
from ..schemas import Strict
from ..voice import launch
from ..voice import policy as policy_mod
from ..voice.languages import LANGUAGES, PROVIDERS, coverage
from ..voice.routing import NoCompliantRoute, VoicePolicy, select_route
from ..worker_deps import WorkerContext, worker_context

router = APIRouter(prefix="/v1/orgs/{org_id}/voice", tags=["voice"])
worker_router = APIRouter(prefix="/v1/worker/voice", tags=["worker"])
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
        "launch": launch.status(),
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
    return _route(body.language, policy)


def _route(language: str, policy: VoicePolicy) -> dict:
    try:
        r = select_route(language, policy, configured_providers())
    except NoCompliantRoute as e:
        return {"routable": False, "language": language, "gaps": e.gaps}
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


ProviderId = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[a-z0-9-]+$")]


class PolicyIn(Strict):
    default_language: Locale
    languages: list[Locale] = Field(min_length=1, max_length=20)
    fallback_language: Locale | None = None
    allowed_regions: list[Region] = Field(min_length=1, max_length=5)
    blocked_providers: list[ProviderId] = Field(default_factory=list, max_length=20)
    preferred_providers: list[ProviderId] = Field(default_factory=list, max_length=20)
    allow_paid: bool = False
    allow_unverified: bool = False


@router.get("/policy")
def get_policy(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> dict:
    saved = db.get(VoicePolicyRow, ctx.org_id) is not None
    return policy_mod.as_dict(policy_mod.load(db, ctx.org_id), saved)


@router.put("/policy")
def put_policy(
    body: PolicyIn, ctx: Annotated[OrgContext, Depends(require(Perm.business_write))], db: DB, request: Request
) -> dict:
    """Replaces the workspace's voice policy. Validated exactly as routing will use it."""
    try:
        new = policy_mod.build(**body.model_dump())
    except policy_mod.PolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    before = policy_mod.as_dict(policy_mod.load(db, ctx.org_id), True)
    policy_mod.save(db, ctx.org_id, ctx.user.id, new)
    after = policy_mod.as_dict(new, True)
    changed = sorted(k for k in after if k != "saved" and after[k] != before[k])
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "voice_policy.updated",
        "voice_policy",
        ctx.org_id,
        {"changed": changed},
        client_meta(request),
    )
    db.commit()
    return after


@router.get("/route")
def saved_route(
    ctx: Annotated[OrgContext, Depends(require(Perm.read))],
    db: DB,
    language: str = Query(pattern=r"^[a-z]{2,3}-[A-Z]{2}$"),
) -> dict:
    """The route a call in this language would take under the workspace's saved policy."""
    if language not in LANGUAGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown language: {language}")
    return _route(language, policy_mod.load(db, ctx.org_id))


@router.get("/numbers")
def list_numbers(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> list[dict]:
    return [
        {"e164": n.e164, "status": n.status, "label": n.label, "created_at": n.created_at.isoformat()}
        for n in policy_mod.numbers(db, ctx.org_id)
    ]


@worker_router.get("/policy")
def worker_policy(worker: Annotated[WorkerContext, Depends(worker_context)], db: DB) -> dict:
    """The saved policy for the token's workspace, so the worker accepts exactly the languages the
    workspace allows instead of its own environment settings."""
    saved = db.get(VoicePolicyRow, worker.org_id) is not None
    return policy_mod.as_dict(policy_mod.load(db, worker.org_id), saved)
