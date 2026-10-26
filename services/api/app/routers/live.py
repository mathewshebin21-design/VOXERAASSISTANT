"""Live AI and speech providers for the Voice lab, behind per-workspace and global monthly caps.

Provider keys stay on the server. Nothing is called unless a key AND a non-zero cap are
configured (see app/config.py). Transcripts are not stored: only metered usage is.
"""

import json
import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy.dialects.postgresql import insert

from ..config import get_settings
from ..db import SessionLocal, set_tenant
from ..deps import DB, OrgContext, require
from ..live import providers
from ..live.budget import budget, require_budget
from ..live.receptionist import TOOLS, load_context, run_tool, system_prompt
from ..models import UsageEvent, UsageKind, UsageSource
from ..permissions import Perm
from ..schemas import Strict

log = logging.getLogger("voxera.live")
router = APIRouter(prefix="/v1/orgs/{org_id}/live", tags=["live"])

MAX_ROUNDS = 3  # model turns per caller turn (tool calls in between)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Models that accept server-side refusal fallback; others (e.g. Claude Haiku 5.5) reject the parameter.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
RequestId = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class LiveMessage(Strict):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=2000)


class BrainIn(Strict):
    request_id: RequestId
    messages: list[LiveMessage] = Field(min_length=1, max_length=40)


class TtsIn(Strict):
    request_id: RequestId
    text: str = Field(min_length=1, max_length=600)


def _llm_ready() -> bool:
    return get_settings().anthropic_api_key is not None


def _tts_ready() -> bool:
    s = get_settings()
    return s.elevenlabs_api_key is not None and bool(s.elevenlabs_voice_id)


def _record(org_id: uuid.UUID, user_id: uuid.UUID, kind: UsageKind, qty: int, key: str, ref: str) -> None:
    """Records live usage in its own transaction (the request's session may already be closed)."""
    db = SessionLocal()
    try:
        set_tenant(db, org_id=org_id, user_id=user_id)
        db.execute(
            insert(UsageEvent)
            .values(
                organization_id=org_id,
                kind=kind,
                source=UsageSource.live,
                quantity=qty,
                occurred_at=datetime.now(UTC),
                idempotency_key=key,
                reference=ref,
            )
            .on_conflict_do_nothing(constraint="uq_usage_idempotency")
        )
        db.commit()
    except Exception:  # never lose the response over metering, but make it loud
        log.exception("failed to record live usage", extra={"org_id": str(org_id), "kind": kind.value, "qty": qty})
    finally:
        db.close()


@router.get("/status")
def live_status(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> dict:
    s = get_settings()

    def info(ready: bool, kind: UsageKind, provider: str, model: str) -> dict:
        b = budget(db, ctx.org_id, kind)
        return {
            "available": ready and b.org_cap > 0 and b.global_cap > 0,
            "configured": ready,
            "provider": provider,
            "model": model,
            "unit": kind.value,
            "org_cap": b.org_cap,
            "org_used": b.org_used,
            "remaining": b.remaining,
        }

    return {
        "llm": info(_llm_ready(), UsageKind.llm_tokens, "Anthropic", s.llm_model),
        "tts": info(_tts_ready(), UsageKind.tts_characters, "ElevenLabs", s.elevenlabs_model),
    }


@router.get("/greeting")
def greeting(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> dict:
    """The workspace's saved greeting plus its recording disclosure — no model call, so it is free and exact."""
    c = load_context(db, ctx.org_id)
    return {"text": " ".join(x for x in [c.greeting.replace("{business}", c.name), c.disclosure] if x)}


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _usage_total(u: object) -> int:
    return sum(
        int(getattr(u, f, 0) or 0)
        for f in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    )


@router.post("/brain")
def brain(body: BrainIn, ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))], db: DB) -> StreamingResponse:
    """Streams one receptionist reply as server-sent events: text, tool, error, done."""
    s = get_settings()
    if not _llm_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No language-model provider key is configured")
    if body.messages[-1].role != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The last message must be the caller's")
    # Worst case for this request: every round re-reads the history plus tool data, and writes max output.
    est_input = sum(len(m.text) for m in body.messages) // 3 + 2500
    require_budget(db, ctx.org_id, UsageKind.llm_tokens, (est_input + s.llm_max_output_tokens) * MAX_ROUNDS)
    bctx = load_context(db, ctx.org_id)
    org_id, user_id = ctx.org_id, ctx.user.id
    client = providers.llm_client()

    msgs: list[dict] = [{"role": m.role, "content": m.text} for m in body.messages]
    if msgs[0]["role"] == "assistant":  # the conversation must open with a user turn
        msgs.insert(0, {"role": "user", "content": "(The call has just connected.)"})

    fallback = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if s.llm_model in FALLBACK_MODELS else {}

    def gen() -> Iterator[str]:
        used = 0
        partial_in = partial_chars = 0
        try:
            for _ in range(MAX_ROUNDS):
                partial_in = partial_chars = 0
                with client.beta.messages.stream(
                    model=s.llm_model,
                    max_tokens=s.llm_max_output_tokens,
                    system=system_prompt(bctx),
                    tools=TOOLS,
                    messages=msgs,
                    output_config={"effort": s.llm_effort},
                    **fallback,
                ) as stream:
                    for event in stream:
                        if event.type == "message_start":
                            partial_in = _usage_total(event.message.usage)
                        elif event.type == "text":
                            partial_chars += len(event.text)
                            yield _sse({"type": "text", "text": event.text})
                    final = stream.get_final_message()
                used += _usage_total(final.usage)
                partial_in = partial_chars = 0
                if final.stop_reason == "refusal":
                    yield _sse({"type": "error", "message": "The model declined to answer this turn."})
                    break
                tool_uses = [b for b in final.content if b.type == "tool_use"]
                if not tool_uses:
                    break
                if final.stop_reason == "max_tokens":
                    yield _sse({"type": "error", "message": "Reply was cut off before a tool call finished."})
                    break
                results = []
                for b in tool_uses:
                    ok, out = run_tool(bctx, b.name, b.input)
                    yield _sse(
                        {"type": "tool", "name": b.name, "ok": ok, "result": "workspace data returned" if ok else out}
                    )
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": b.id,
                            "content": out,
                            **({} if ok else {"is_error": True}),
                        }
                    )
                msgs.append({"role": "assistant", "content": final.content})
                msgs.append({"role": "user", "content": results})
            yield _sse({"type": "done", "llm_tokens": used})
        except anthropic.RateLimitError:
            yield _sse({"type": "error", "message": "Language model is rate limited."})
        except anthropic.APIStatusError as e:
            log.warning("llm provider error", extra={"status": e.status_code, "request_id": e.request_id})
            yield _sse({"type": "error", "message": f"Language model error (HTTP {e.status_code})."})
        except anthropic.APIConnectionError:
            yield _sse({"type": "error", "message": "Could not reach the language model."})
        except ValueError:  # unparseable streamed tool input
            yield _sse({"type": "error", "message": "The model produced an invalid tool call."})
        finally:
            # A caller barge-in closes the stream mid-reply; the provider still bills what it produced.
            used += partial_in + (partial_chars // 3 if partial_in else 0)
            if used:
                _record(org_id, user_id, UsageKind.llm_tokens, used, f"llm-{body.request_id}", "voice lab brain")

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store"})


@router.post("/tts")
def tts(body: TtsIn, ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))], db: DB) -> StreamingResponse:
    """Synthesises one sentence as MP3. Characters are metered before the call (conservative)."""
    if not _tts_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No text-to-speech provider key is configured")
    require_budget(db, ctx.org_id, UsageKind.tts_characters, len(body.text))
    db.rollback()
    _record(
        ctx.org_id, ctx.user.id, UsageKind.tts_characters, len(body.text), f"tts-{body.request_id}", "voice lab tts"
    )
    http = providers.tts_http()
    try:
        r = http.send(providers.tts_request(http, body.text), stream=True)
    except Exception:
        http.close()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach the text-to-speech provider") from None
    if r.status_code != 200:
        r.close()
        http.close()
        log.warning("tts provider error", extra={"status": r.status_code})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Text-to-speech provider error (HTTP {r.status_code})")

    def chunks() -> Iterator[bytes]:
        try:
            yield from r.iter_bytes()
        finally:
            r.close()
            http.close()

    return StreamingResponse(chunks(), media_type="audio/mpeg", headers={"cache-control": "no-store"})
