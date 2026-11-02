"""Live AI and speech providers for the Voice lab, behind per-workspace and global monthly caps.

Provider keys stay on the server. Nothing is called unless a key AND a non-zero cap are
configured (see app/config.py). Transcripts are not stored: only metered usage is.
"""

import json
import logging
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Annotated, Literal

import anthropic
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, set_tenant
from ..deps import DB, OrgContext, require
from ..live import providers, setup_agent
from ..live.budget import budget, require_budget
from ..live.receptionist import TOOLS, Turn, load_context, run_tool, system_prompt
from ..models import UsageEvent, UsageKind, UsageSource
from ..permissions import Perm, has_perm
from ..schemas import Strict

log = logging.getLogger("voxera.live")
router = APIRouter(prefix="/v1/orgs/{org_id}/live", tags=["live"])

MAX_ROUNDS = 6  # model turns per caller turn (e.g. check availability → book → confirm)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Models that accept server-side refusal fallback; others (e.g. Claude Haiku 5.5) reject the parameter.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
RequestId = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class LiveMessage(Strict):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=2000)


class BrainIn(Strict):
    request_id: RequestId
    # One id per call: makes bookings idempotent if a turn is retried.
    conversation_id: RequestId | None = None
    messages: list[LiveMessage] = Field(min_length=1, max_length=40)


class TtsIn(Strict):
    request_id: RequestId
    text: str = Field(min_length=1, max_length=600)


def _llm_ready() -> bool:
    return providers.llm_ready()


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
        "llm": info(_llm_ready(), UsageKind.llm_tokens, providers.llm_label(), s.model or "not set"),
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
    msgs: list[dict] = [{"role": m.role, "content": m.text} for m in body.messages]
    if msgs[0]["role"] == "assistant":  # the conversation must open with a user turn
        msgs.insert(0, {"role": "user", "content": "(The call has just connected.)"})

    turn = Turn(org_id, body.conversation_id or body.request_id, body.messages[-1].text)
    read_only = {"get_business_info", "get_opening_hours", "list_services"}

    def run(tdb, name, args):
        ok, out = run_tool(tdb, bctx, turn, name, args)
        return ok, out, ("workspace data returned" if ok and name in read_only else out[:300])

    def after() -> Iterator[str]:
        if turn.handoff:
            h = turn.handoff
            yield _sse({"type": "handoff", "outcome": h.outcome, "staff": h.staff_name, "case": str(h.case.id)[:8]})

    gen = _llm_stream(
        system=system_prompt(bctx),
        tools=TOOLS,
        msgs=msgs,
        run=run,
        after=after,
        org_id=org_id,
        user_id=user_id,
        usage_key=f"llm-{body.request_id}",
        reference="voice lab brain",
    )
    return StreamingResponse(gen, media_type="text/event-stream", headers={"cache-control": "no-store"})


def _llm_stream(**kw) -> Iterator[str]:
    """The configured provider's tool-using conversation, as server-sent events."""
    if get_settings().llm_provider == "anthropic":
        return _agent_stream(client=providers.llm_client(), **kw)
    return _openai_stream(**kw)


class _HideThinking:
    """Drops <think>…</think> reasoning that some open models (e.g. Qwen) put in their reply text."""

    def __init__(self) -> None:
        self.buf = ""
        self.inside = False

    def feed(self, text: str) -> str:
        self.buf += text
        out = ""
        while self.buf:
            tag = "</think>" if self.inside else "<think>"
            i = self.buf.find(tag)
            if i >= 0:
                out += "" if self.inside else self.buf[:i]
                self.buf = self.buf[i + len(tag) :]
                self.inside = not self.inside
                continue
            keep = next((n for n in range(len(tag) - 1, 0, -1) if self.buf.endswith(tag[:n])), 0)
            out += "" if self.inside else self.buf[: len(self.buf) - keep]
            self.buf = self.buf[len(self.buf) - keep :]
            break
        return out


def _openai_stream(
    *,
    system: str,
    tools: list[dict],
    msgs: list[dict],
    run: Callable[[Session, str, object], tuple[bool, str, str]],
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    usage_key: str,
    reference: str,
    after: Callable[[], Iterator[str]] | None = None,
) -> Iterator[str]:
    """The same conversation as _agent_stream, through an OpenAI-compatible chat API (Groq,
    Gemini, OpenRouter, Ollama…). Uses the provider's token counts when it sends them, and
    otherwise a conservative estimate, so the monthly caps still hold."""
    s = get_settings()
    convo: list[dict] = [{"role": "system", "content": system}, *msgs]
    fn_tools = providers.openai_tools(tools, s.llm_provider)
    used = 0
    sent_chars = 0
    http = providers.openai_http()
    tdb = SessionLocal()
    set_tenant(tdb, org_id=org_id, user_id=user_id)
    try:
        for _ in range(MAX_ROUNDS):
            body: dict = {
                "model": s.model,
                "messages": convo,
                "tools": fn_tools,
                "stream": True,
                "max_tokens": s.llm_max_output_tokens,
            }
            if s.llm_provider in ("groq", "openrouter", "openai_compatible"):
                body["stream_options"] = {"include_usage": True}
            prompt_chars = len(json.dumps(convo)) + len(json.dumps(fn_tools))
            text_out, calls, finish, usage = "", {}, None, 0
            hide = _HideThinking()
            sent_chars = prompt_chars
            r = http.send(providers.openai_request(http, body), stream=True)
            try:
                if r.status_code != 200:
                    r.read()
                    raise httpx.HTTPStatusError("provider error", request=r.request, response=r)
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    u = chunk.get("usage") or {}
                    usage = max(usage, int(u.get("total_tokens") or 0))
                    for ch in chunk.get("choices") or []:
                        d = ch.get("delta") or {}
                        if d.get("content"):
                            shown = hide.feed(d["content"])
                            text_out += d["content"]
                            if shown:
                                yield _sse({"type": "text", "text": shown})
                        for n, tc in enumerate(d.get("tool_calls") or []):
                            slot = calls.setdefault(tc.get("index", n), {"id": None, "name": "", "args": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            f = tc.get("function") or {}
                            slot["name"] += f.get("name") or ""
                            slot["args"] += f.get("arguments") or ""
                        finish = ch.get("finish_reason") or finish
            finally:
                r.close()
            used += usage or (prompt_chars + len(text_out) + sum(len(c["args"]) for c in calls.values())) // 3
            sent_chars = 0
            if not calls:
                break
            if finish == "length":
                yield _sse({"type": "error", "message": "Reply was cut off before a tool call finished."})
                break
            ordered = [calls[k] for k in sorted(calls)]
            for i, c in enumerate(ordered):
                c["id"] = c["id"] or f"call_{i}"
            convo.append(
                {
                    "role": "assistant",
                    "content": text_out or None,
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["args"] or "{}"},
                        }
                        for c in ordered
                    ],
                }
            )
            for c in ordered:
                args = json.loads(c["args"]) if c["args"].strip() else {}
                ok, out, shown = run(tdb, c["name"], args)
                yield _sse({"type": "tool", "name": c["name"], "ok": ok, "result": shown})
                convo.append({"role": "tool", "tool_call_id": c["id"], "content": out})
        if after:
            yield from after()
        yield _sse({"type": "done", "llm_tokens": used})
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        log.warning("llm provider error", extra={"status": code, "provider": s.llm_provider})
        msg = "Language model is rate limited." if code == 429 else f"Language model error (HTTP {code})."
        yield _sse({"type": "error", "message": msg})
    except httpx.HTTPError:
        yield _sse({"type": "error", "message": "Could not reach the language model."})
    except ValueError:  # unparseable stream or tool arguments
        yield _sse({"type": "error", "message": "The model produced an invalid tool call."})
    finally:
        tdb.close()
        http.close()
        used += sent_chars // 3  # an interrupted request still counts what was sent
        if used:
            _record(org_id, user_id, UsageKind.llm_tokens, used, usage_key, reference)


def _agent_stream(
    *,
    client: anthropic.Anthropic,
    system: str,
    tools: list[dict],
    msgs: list[dict],
    run: Callable[[Session, str, object], tuple[bool, str, str]],
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    usage_key: str,
    reference: str,
    after: Callable[[], Iterator[str]] | None = None,
) -> Iterator[str]:
    """Streams a tool-using Claude conversation as server-sent events (text, tool, error, done),
    running tools in a fresh tenant-scoped session and metering the tokens it used."""
    s = get_settings()
    fallback = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if s.model in FALLBACK_MODELS else {}
    used = 0
    partial_in = partial_chars = 0
    tdb = SessionLocal()  # the request's session is closed once streaming starts
    set_tenant(tdb, org_id=org_id, user_id=user_id)
    try:
        for _ in range(MAX_ROUNDS):
            partial_in = partial_chars = 0
            with client.beta.messages.stream(
                model=s.model,
                max_tokens=s.llm_max_output_tokens,
                system=system,
                tools=tools,
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
                ok, out, shown = run(tdb, b.name, b.input)
                yield _sse({"type": "tool", "name": b.name, "ok": ok, "result": shown})
                results.append(
                    {"type": "tool_result", "tool_use_id": b.id, "content": out, **({} if ok else {"is_error": True})}
                )
            msgs.append({"role": "assistant", "content": final.content})
            msgs.append({"role": "user", "content": results})
        if after:
            yield from after()
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
        tdb.close()
        # An interrupted stream still bills what the provider produced.
        used += partial_in + (partial_chars // 3 if partial_in else 0)
        if used:
            _record(org_id, user_id, UsageKind.llm_tokens, used, usage_key, reference)


# ---------- setup assistant ----------


class SetupIn(Strict):
    request_id: RequestId
    messages: list[LiveMessage] = Field(min_length=1, max_length=60)


def _setup_perm(ctx: Annotated[OrgContext, Depends(require(Perm.business_write))]) -> OrgContext:
    if not has_perm(ctx.membership.role, Perm.agent_write):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and admins can run the setup assistant")
    return ctx


@router.get("/setup-assistant/status")
def setup_status(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> dict:
    """Whether the Claude-powered assistant can run; otherwise the app uses its free guided mode."""
    b = budget(db, ctx.org_id, UsageKind.llm_tokens)
    return {"ai": _llm_ready() and b.org_cap > 0 and b.global_cap > 0 and b.remaining > 0}


@router.post("/setup-assistant")
def setup_assistant(body: SetupIn, ctx: Annotated[OrgContext, Depends(_setup_perm)], db: DB) -> StreamingResponse:
    """One turn of the setup conversation, streamed: text, tool (what was saved), error, done."""
    s = get_settings()
    if not _llm_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No language-model provider key is configured")
    if body.messages[-1].role != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The last message must be yours")
    est_input = sum(len(m.text) for m in body.messages) // 3 + 3000
    require_budget(db, ctx.org_id, UsageKind.llm_tokens, (est_input + s.llm_max_output_tokens) * MAX_ROUNDS)
    name = load_context(db, ctx.org_id).name
    msgs: list[dict] = [{"role": m.role, "content": m.text} for m in body.messages]
    if msgs[0]["role"] == "assistant":
        msgs.insert(0, {"role": "user", "content": "(Opened the setup assistant.)"})
    sctx = setup_agent.SetupContext(ctx.org_id, ctx.user.id)

    def run(tdb, tool, args):
        ok, out = setup_agent.run_tool(tdb, sctx, tool, args)
        return ok, out, out[:300]

    gen = _llm_stream(
        system=setup_agent.system_prompt(name),
        tools=setup_agent.TOOLS,
        msgs=msgs,
        run=run,
        org_id=ctx.org_id,
        user_id=ctx.user.id,
        usage_key=f"setup-{body.request_id}",
        reference="setup assistant",
    )
    return StreamingResponse(gen, media_type="text/event-stream", headers={"cache-control": "no-store"})


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
