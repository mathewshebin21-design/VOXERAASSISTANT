"""Live AI and speech providers for the Voice lab, behind per-workspace and global monthly caps.

Provider keys stay on the server. Nothing is called unless a key AND a non-zero cap are
configured (see app/config.py). Transcripts are not stored: only metered usage is.
"""

import contextlib
import json
import logging
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from typing import Annotated, Literal

import anthropic
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy.orm import Session

from .. import calls as calls_mod
from .. import worker_auth
from ..config import get_settings
from ..db import SessionLocal, set_tenant
from ..deps import DB, OrgContext, require
from ..live import budget as budget_mod
from ..live import providers, setup_agent, toolcheck
from ..live.budget import budget
from ..live.receptionist import CLOCK_LINE, TOOLS, Turn, load_context, run_tool, system_prompt
from ..models import Organization, UsageKind, WorkspaceSettings
from ..permissions import Perm, has_perm
from ..schemas import Strict
from ..voice import launch
from ..voice.languages import LANGUAGES
from ..voice.regions import country_of
from ..voice.routing import language_instruction

log = logging.getLogger("voxera.live")
router = APIRouter(prefix="/v1/orgs/{org_id}/live", tags=["live"])
worker_router = APIRouter(prefix="/v1/worker", tags=["worker"])

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
    # A call record (POST /calls) to add this turn to: the caller's words, tools, the reply, metrics.
    call_id: uuid.UUID | None = None
    # The language the call is being conducted in (BCP 47, from the language registry). The model
    # replies directly in it; the instruction sits after the cache breakpoint, like the clock.
    language: str | None = Field(None, pattern=r"^[a-z]{2,3}-[A-Z]{2}$")


class TtsIn(Strict):
    request_id: RequestId
    text: str = Field(min_length=1, max_length=600)


def _llm_ready() -> bool:
    return providers.llm_ready()


def _tts_ready() -> bool:
    s = get_settings()
    return s.elevenlabs_api_key is not None and bool(s.elevenlabs_voice_id)


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
            "org_reserved": b.org_reserved,
            "limit_note": f"Caps count {kind.value.replace('_', ' ')}, not a monetary amount. VOXERA cannot "
            "enforce a spending limit in money: set one in the provider's own console.",
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


def system_blocks(system: str) -> list[dict]:
    """The system prompt as cacheable blocks: the stable instructions carry the cache breakpoint
    (which also covers the tool definitions, sent before the system prompt), and the clock line,
    which changes every minute, comes after it so it never invalidates the cached prefix."""
    head, sep, tail = system.rpartition("\n\n" + CLOCK_LINE)
    stable, clock = (head, CLOCK_LINE + tail) if sep else (system, "")
    blocks: list[dict] = [{"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}}]
    if clock:
        blocks.append({"type": "text", "text": clock})
    return blocks


@dataclass
class TurnMetrics:
    """What one caller turn cost and how long it took, as far as the provider reports it."""

    rounds: int = 0
    input_tokens: int = 0  # uncached input
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    first_text_ms: int | None = None  # from the start of the turn to the first text sent on
    tool_ms: int = 0  # time spent running tools

    def add_usage(self, u: object) -> None:
        get = lambda f: int(getattr(u, f, 0) or 0)  # noqa: E731
        self.input_tokens += get("input_tokens")
        self.cache_read_tokens += get("cache_read_input_tokens")
        self.cache_write_tokens += get("cache_creation_input_tokens")
        self.output_tokens += get("output_tokens")


def _log_turn(m: TurnMetrics, provider: str, ok: bool, started: float) -> None:
    """Logs a turn's metrics. Runs after the usage is settled, and can never break a turn."""
    with contextlib.suppress(Exception):  # metrics are best effort
        _emit_turn(m, provider, ok, started)


def _emit_turn(m: TurnMetrics, provider: str, ok: bool, started: float) -> None:
    log.info(
        "llm turn",
        extra={
            "metrics": {
                "provider": provider,
                "ok": ok,
                "total_ms": int((time.monotonic() - started) * 1000),
                "clients_created": dict(providers.CLIENTS_CREATED),
                **asdict(m),
            }
        },
    )


def _usage_total(u: object) -> int:
    return sum(
        int(getattr(u, f, 0) or 0)
        for f in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    )


@router.post("/brain")
def brain(body: BrainIn, ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))], db: DB) -> StreamingResponse:
    """Streams one receptionist reply as server-sent events: text, tool, error, done."""
    return _brain(body, ctx.org_id, ctx.user.id, db)


@worker_router.post("/live/brain")
def worker_brain(body: BrainIn, request: Request, db: DB) -> StreamingResponse:
    """The same brain for a voice worker holding a scoped worker token (ADR-0005 §3). The workspace
    comes from the token, never from the request. 404 unless worker credentials are enabled."""
    if not worker_auth.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Worker token required")
    try:
        org_id, mode = worker_auth.verify(header[7:].strip())
    except worker_auth.WorkerAuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e)) from None
    set_tenant(db, org_id=org_id)
    if db.get(Organization, org_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation not found")
    if mode == "live":  # real callers only where the business's country passed its launch review
        ws = db.get(WorkspaceSettings, org_id)
        country = country_of(ws.locale if ws else None) or ""
        if not launch.ready(country):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Live calls are not enabled for this country yet")
    return _brain(body, org_id, None, db)


def _brain(body: BrainIn, org_id: uuid.UUID, user_id: uuid.UUID | None, db: Session) -> StreamingResponse:
    if not _llm_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No language-model provider key is configured")
    if body.messages[-1].role != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The last message must be the caller's")
    if body.call_id is not None:  # refuse before spending anything
        try:
            call = calls_mod.get(db, org_id, body.call_id)
        except calls_mod.CallError as e:
            raise HTTPException(e.status, str(e)) from None
        if call.status != "in_progress":
            raise HTTPException(status.HTTP_409_CONFLICT, "The call has ended")
    bctx = load_context(db, org_id)
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

    system = system_prompt(bctx)
    if body.language is not None:
        if body.language not in LANGUAGES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown language")
        if (line := language_instruction(body.language)) is not None:
            system += "\n" + line  # after the clock line, so in the per-turn (uncached) block
    # Hold this turn's worst case against the monthly caps before calling the provider (atomic).
    allowance = turn_allowance(system, TOOLS, msgs)
    budget_mod.reserve(db, org_id, UsageKind.llm_tokens, allowance, f"llm-{body.request_id}")
    gen = _llm_stream(
        system=system,
        tools=TOOLS,
        msgs=msgs,
        run=run,
        after=after,
        org_id=org_id,
        user_id=user_id,
        usage_key=f"llm-{body.request_id}",
        reference="voice lab brain",
        reserved=allowance,
    )
    if body.call_id is not None:
        gen = _record_call(gen, org_id, user_id, body.call_id, body.messages[-1].text)
    return StreamingResponse(gen, media_type="text/event-stream", headers={"cache-control": "no-store"})


def _record_call(gen: Iterator[str], org_id: uuid.UUID, user_id: uuid.UUID | None, call_id: uuid.UUID, said: str):
    """Passes the stream through unchanged, then adds the turn to the call record.

    Recording runs after the stream ends (or the listener leaves), in its own session, and is best
    effort: a failure is logged and never breaks the caller's turn.
    """
    reply, tools, handoffs, errors, metrics = [], [], [], [], None
    try:
        for chunk in gen:
            with contextlib.suppress(ValueError, KeyError):
                e = json.loads(chunk.removeprefix("data: "))
                kind = e.get("type")
                if kind == "text":
                    reply.append(e["text"])
                elif kind == "tool":
                    tools.append({"name": e.get("name"), "ok": bool(e.get("ok"))})
                elif kind == "handoff":
                    handoffs.append({"outcome": e.get("outcome")})
                elif kind == "error":
                    errors.append({"message": str(e.get("message", ""))[:300]})
                elif kind == "done":
                    metrics = e.get("metrics")
            yield chunk
    finally:
        events: list[dict] = [{"kind": "utterance", "speaker": "caller", "text": said[:4000]}]
        events += [{"kind": "tool", "speaker": "agent", "data": t} for t in tools]
        events += [{"kind": "handoff", "speaker": "agent", "data": h} for h in handoffs]
        text = "".join(reply).strip()
        if text:
            events.append({"kind": "utterance", "speaker": "agent", "text": text[:4000], "data": {"metrics": metrics}})
        elif metrics:
            events.append({"kind": "system", "speaker": "system", "data": {"metrics": metrics}})
        events += [{"kind": "error", "speaker": "system", "data": er} for er in errors]
        _save_call_events(org_id, user_id, call_id, events)


def _save_call_events(org_id: uuid.UUID, user_id: uuid.UUID | None, call_id: uuid.UUID, events: list[dict]) -> None:
    rdb = SessionLocal()
    try:
        set_tenant(rdb, org_id=org_id, user_id=user_id)
        calls_mod.append(rdb, org_id, call_id, events)
        rdb.commit()
    except Exception as e:  # noqa: BLE001 — recording must never break the turn
        rdb.rollback()
        log.warning("call record not updated", extra={"error": type(e).__name__, "reason": str(e)[:200]})
    finally:
        rdb.close()


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


def _llm_stream(**kw) -> Iterator[str]:
    """The configured provider's tool-using conversation, as server-sent events."""
    if get_settings().llm_provider == "anthropic":
        return _agent_stream(client=providers.llm_client(), **kw)
    return _openai_stream(**kw)


TURN_DEADLINE_S = 60.0  # one caller turn, all rounds included; a phone caller won't wait longer
MAX_CALLS_PER_ROUND = 8
MAX_TOOL_INDEX = 15


class StreamFault(Exception):
    """A provider reply that can't be trusted or finished. The message is safe to show."""


def _prompt_chars(system: str, tools: list[dict], msgs: list[dict]) -> int:
    return len(system) + len(json.dumps(tools, default=str)) + len(json.dumps(msgs, default=str))


def turn_allowance(system: str, tools: list[dict], msgs: list[dict]) -> int:
    """The most tokens one caller turn may use: every round re-reads the prompt (which grows with
    tool results) and may write the maximum output. Reserved before the turn and enforced per round."""
    s = get_settings()
    first = _prompt_chars(system, tools, msgs) // 3
    growth = 1500  # tool results and the model's own tool calls added per round
    return sum(first + growth * i + s.llm_max_output_tokens for i in range(MAX_ROUNDS))


def _tool_event(by_name: dict[str, dict], name: object, ok: bool, shown: str) -> str:
    safe = name if isinstance(name, str) and name in by_name else "invalid_tool_call"
    return _sse({"type": "tool", "name": safe, "ok": ok, "result": shown})


def _exec_tool(
    tdb: Session,
    run: Callable[[Session, str, dict], tuple[bool, str, str]],
    by_name: dict[str, dict],
    name: object,
    args: object,
) -> tuple[bool, str, str]:
    """Validates a model's tool call against the offered tools' schemas, then runs it. Never raises."""
    try:
        valid = toolcheck.validate_call(by_name, name, args)
    except toolcheck.ToolCallError as e:
        msg = json.dumps({"error": f"Tool call rejected, nothing was done: {e}"})
        return False, msg, msg[:300]
    try:
        return run(tdb, name, valid)  # type: ignore[arg-type]  # name is a str once validated
    except Exception:
        tdb.rollback()
        log.exception("live tool failed", extra={"tool": name})
        msg = json.dumps({"error": "That couldn't be done because of a problem on our side. Nothing was changed."})
        return False, msg, "internal error"


def _fail(e: BaseException, provider: str) -> str:
    """The error event for a failed turn (and a log line)."""
    if isinstance(e, StreamFault):
        log.warning("llm stream fault", extra={"provider": provider, "reason": str(e)})
        return _sse({"type": "error", "message": str(e)})
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        log.warning("llm provider error", extra={"status": code, "provider": provider})
        msg = "Language model is rate limited." if code == 429 else f"Language model error (HTTP {code})."
        return _sse({"type": "error", "message": msg})
    if isinstance(e, httpx.TimeoutException | anthropic.APITimeoutError):
        return _sse({"type": "error", "message": "The language model timed out."})
    if isinstance(e, anthropic.RateLimitError):
        return _sse({"type": "error", "message": "Language model is rate limited."})
    if isinstance(e, anthropic.APIStatusError):
        log.warning("llm provider error", extra={"status": e.status_code, "request_id": e.request_id})
        return _sse({"type": "error", "message": f"Language model error (HTTP {e.status_code})."})
    if isinstance(e, httpx.HTTPError | anthropic.APIConnectionError):
        return _sse({"type": "error", "message": "Could not reach the language model."})
    log.exception("live turn failed", exc_info=e)
    return _sse({"type": "error", "message": "Something went wrong on our side. Nothing more was changed."})


def _no_constants(token: str) -> object:
    raise StreamFault("The language model sent a malformed reply.")


def _chunk(data: str) -> dict:
    """One streamed chat-completions chunk, shape-checked."""
    try:
        chunk = json.loads(data, parse_constant=_no_constants)
    except ValueError:
        raise StreamFault("The language model sent a malformed reply.") from None
    if not isinstance(chunk, dict):
        raise StreamFault("The language model sent a malformed reply.")
    if chunk.get("error") is not None:  # providers report mid-stream failures as an error event
        raise StreamFault("The language model reported an error mid-reply.")
    choices = chunk.get("choices")
    if choices is None:
        chunk["choices"] = []
    elif not isinstance(choices, list) or not all(isinstance(c, dict) for c in choices):
        raise StreamFault("The language model sent a malformed reply.")
    return chunk


def _usage_tokens(chunk: dict) -> int:
    u = chunk.get("usage")
    t = u.get("total_tokens") if isinstance(u, dict) else None
    return t if isinstance(t, int) and not isinstance(t, bool) and 0 <= t < 10_000_000 else 0


def _openai_usage(chunk: dict, m: TurnMetrics) -> None:
    """Records the token counts an OpenAI-compatible provider reports (usually on the last chunk),
    including cached prompt tokens where the provider exposes them."""
    u = chunk.get("usage")
    if not isinstance(u, dict):
        return

    def num(v: object) -> int:
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 10_000_000 else 0

    details = u.get("prompt_tokens_details")
    cached = num(details.get("cached_tokens")) if isinstance(details, dict) else 0
    m.cache_read_tokens += cached
    m.input_tokens += max(0, num(u.get("prompt_tokens")) - cached)
    m.output_tokens += num(u.get("completion_tokens"))


def _openai_stream(
    *,
    system: str,
    tools: list[dict],
    msgs: list[dict],
    run: Callable[[Session, str, dict], tuple[bool, str, str]],
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    usage_key: str,
    reference: str,
    reserved: int,
    after: Callable[[], Iterator[str]] | None = None,
) -> Iterator[str]:
    """The same conversation as _agent_stream, through an OpenAI-compatible chat API (Groq,
    Gemini, OpenRouter, Ollama…). Every chunk is shape-checked; a reply only counts as complete
    with a finish reason or [DONE]; tool calls run only from complete replies and only after
    validation. Uses the provider's token counts when it sends them, and otherwise a
    conservative estimate, so the monthly caps still hold."""
    s = get_settings()
    convo: list[dict] = [{"role": "system", "content": system}, *msgs]
    fn_tools = providers.openai_tools(tools, s.llm_provider)
    by_name = {t["name"]: t for t in tools}
    used = 0
    pending = 0  # estimate for the round in flight, counted if it is interrupted
    started = time.monotonic()
    deadline = started + TURN_DEADLINE_S
    m, ok = TurnMetrics(), False
    http = providers.openai_http()  # shared and reused; only responses are closed here
    tdb = SessionLocal()
    set_tenant(tdb, org_id=org_id, user_id=user_id)
    try:
        for _ in range(MAX_ROUNDS):
            prompt_chars = len(json.dumps(convo)) + len(json.dumps(fn_tools))
            if used + prompt_chars // 3 + s.llm_max_output_tokens > reserved:
                raise StreamFault("This turn reached its usage allowance.")
            body: dict = {
                "model": s.model,
                "messages": convo,
                "tools": fn_tools,
                "stream": True,
                "max_tokens": s.llm_max_output_tokens,
            }
            if s.llm_provider in ("groq", "openrouter", "openai_compatible"):
                body["stream_options"] = {"include_usage": True}
            text_out, calls, finish, usage, done = "", {}, None, 0, False
            last_usage: dict | None = None
            hide = _HideThinking()
            pending = prompt_chars // 3
            r = http.send(providers.openai_request(http, body), stream=True)
            try:
                if r.status_code != 200:
                    r.read()
                    raise httpx.HTTPStatusError("provider error", request=r.request, response=r)
                for line in r.iter_lines():
                    if time.monotonic() > deadline:
                        raise StreamFault("The language model took too long to answer.")
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        done = True
                        break
                    chunk = _chunk(data)
                    usage = max(usage, _usage_tokens(chunk))
                    if isinstance(chunk.get("usage"), dict):
                        last_usage = chunk  # usage is reported once per reply, normally on the last chunk
                    for ch in chunk["choices"]:
                        d = ch.get("delta") or {}
                        content, tcs, fr = (
                            (d.get("content"), d.get("tool_calls"), ch.get("finish_reason"))
                            if isinstance(d, dict)
                            else (0, None, None)
                        )
                        if content is not None and not isinstance(content, str):
                            raise StreamFault("The language model sent a malformed reply.")
                        if fr is not None and not isinstance(fr, str):
                            raise StreamFault("The language model sent a malformed reply.")
                        if tcs is not None and not isinstance(tcs, list):
                            raise StreamFault("The language model sent a malformed tool call.")
                        if content:
                            shown = hide.feed(content)
                            text_out += content
                            if shown:
                                if m.first_text_ms is None:
                                    m.first_text_ms = int((time.monotonic() - started) * 1000)
                                yield _sse({"type": "text", "text": shown})
                        for n, tc in enumerate(tcs or []):
                            idx = tc.get("index", n) if isinstance(tc, dict) else None
                            f = tc.get("function") or {} if isinstance(tc, dict) else None
                            if (
                                not isinstance(idx, int)
                                or isinstance(idx, bool)
                                or not 0 <= idx <= MAX_TOOL_INDEX
                                or not isinstance(f, dict)
                                or not isinstance(f.get("name") or "", str)
                                or not isinstance(f.get("arguments") or "", str)
                                or not isinstance(tc.get("id") or "", str)
                            ):
                                raise StreamFault("The language model sent a malformed tool call.")
                            slot = calls.setdefault(idx, {"id": None, "name": "", "args": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            slot["name"] += f.get("name") or ""
                            slot["args"] += f.get("arguments") or ""
                            if len(slot["args"]) > toolcheck.MAX_ARGS_BYTES:
                                raise StreamFault("The language model sent an oversized tool call.")
                        finish = fr or finish
                    pending = (prompt_chars + len(text_out) + sum(len(c["args"]) for c in calls.values())) // 3
            finally:
                r.close()
            if not done and finish is None:
                raise StreamFault("The language model stopped before finishing its reply.")
            m.rounds += 1
            if last_usage is not None:
                _openai_usage(last_usage, m)
            used += usage or pending
            pending = 0
            if finish == "content_filter":
                raise StreamFault("The language model's safety filter stopped this reply.")
            if not calls:
                if finish == "length":
                    raise StreamFault("The reply was cut off before it finished.")
                break
            if finish == "length":
                raise StreamFault("Reply was cut off before a tool call finished.")
            if len(calls) > MAX_CALLS_PER_ROUND:
                raise StreamFault("The language model asked for too many actions at once.")
            ordered = [calls[k] for k in sorted(calls)]
            ids: set[str] = set()
            for i, c in enumerate(ordered):
                if not c["id"] or c["id"] in ids:
                    c["id"] = f"call_{i}"
                ids.add(c["id"])
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
                try:
                    args = toolcheck.parse_args(c["args"])
                except toolcheck.ToolCallError as e:
                    out = json.dumps({"error": f"Tool call rejected, nothing was done: {e}"})
                    tool_ok, shown = False, out[:300]
                else:
                    t0 = time.monotonic()
                    tool_ok, out, shown = _exec_tool(tdb, run, by_name, c["name"], args)
                    m.tool_ms += int((time.monotonic() - t0) * 1000)
                yield _tool_event(by_name, c["name"], tool_ok, shown)
                convo.append({"role": "tool", "tool_call_id": c["id"], "content": out})
        else:
            raise StreamFault("The receptionist couldn't finish this turn in time.")
        if after:
            yield from after()
        ok = True
        yield _sse({"type": "done", "llm_tokens": used, "metrics": asdict(m)})
    except Exception as e:  # every failure ends the stream with an error event, never a broken response
        yield _fail(e, s.llm_provider)
    finally:
        tdb.close()
        used += pending  # an interrupted or cancelled request still counts what was sent
        budget_mod.settle(org_id, user_id, UsageKind.llm_tokens, usage_key, used, reference)
        _log_turn(m, s.llm_provider, ok, started)


def _agent_stream(
    *,
    client: anthropic.Anthropic,
    system: str,
    tools: list[dict],
    msgs: list[dict],
    run: Callable[[Session, str, dict], tuple[bool, str, str]],
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    usage_key: str,
    reference: str,
    reserved: int,
    after: Callable[[], Iterator[str]] | None = None,
) -> Iterator[str]:
    """Streams a tool-using Claude conversation as server-sent events (text, tool, error, done),
    running validated tools in a fresh tenant-scoped session and metering the tokens it used."""
    s = get_settings()
    fallback = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if s.model in FALLBACK_MODELS else {}
    by_name = {t["name"]: t for t in tools}
    used = 0
    partial_in = partial_chars = 0
    started = time.monotonic()
    deadline = started + TURN_DEADLINE_S
    m, ok = TurnMetrics(), False
    cached_system = system_blocks(system)
    tdb = SessionLocal()  # the request's session is closed once streaming starts
    set_tenant(tdb, org_id=org_id, user_id=user_id)
    try:
        for _ in range(MAX_ROUNDS):
            if used + _prompt_chars(system, tools, msgs) // 3 + s.llm_max_output_tokens > reserved:
                raise StreamFault("This turn reached its usage allowance.")
            partial_in = partial_chars = 0
            with client.beta.messages.stream(
                model=s.model,
                max_tokens=s.llm_max_output_tokens,
                system=cached_system,
                tools=tools,
                messages=msgs,
                output_config={"effort": s.llm_effort},
                **fallback,
            ) as stream:
                for event in stream:
                    if time.monotonic() > deadline:
                        raise StreamFault("The language model took too long to answer.")
                    if event.type == "message_start":
                        partial_in = _usage_total(event.message.usage)
                    elif event.type == "text":
                        partial_chars += len(event.text)
                        if m.first_text_ms is None:
                            m.first_text_ms = int((time.monotonic() - started) * 1000)
                        yield _sse({"type": "text", "text": event.text})
                final = stream.get_final_message()
            used += _usage_total(final.usage)
            m.rounds += 1
            m.add_usage(final.usage)
            partial_in = partial_chars = 0
            if final.stop_reason == "refusal":
                raise StreamFault("The model declined to answer this turn.")
            tool_uses = [b for b in final.content if b.type == "tool_use"]
            if not tool_uses:
                if final.stop_reason == "max_tokens":
                    raise StreamFault("The reply was cut off before it finished.")
                break
            if final.stop_reason == "max_tokens":
                raise StreamFault("Reply was cut off before a tool call finished.")
            if len(tool_uses) > MAX_CALLS_PER_ROUND:
                raise StreamFault("The language model asked for too many actions at once.")
            results = []
            for b in tool_uses:
                t0 = time.monotonic()
                tool_ok, out, shown = _exec_tool(tdb, run, by_name, b.name, b.input)
                m.tool_ms += int((time.monotonic() - t0) * 1000)
                yield _tool_event(by_name, b.name, tool_ok, shown)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "content": out,
                        **({} if tool_ok else {"is_error": True}),
                    }
                )
            msgs.append({"role": "assistant", "content": final.content})
            msgs.append({"role": "user", "content": results})
        else:
            raise StreamFault("The receptionist couldn't finish this turn in time.")
        if after:
            yield from after()
        ok = True
        yield _sse({"type": "done", "llm_tokens": used, "metrics": asdict(m)})
    except Exception as e:  # every failure ends the stream with an error event, never a broken response
        yield _fail(e, "anthropic")
    finally:
        tdb.close()
        # An interrupted or cancelled stream still bills what the provider produced.
        used += partial_in + (partial_chars // 3 if partial_in else 0)
        budget_mod.settle(org_id, user_id, UsageKind.llm_tokens, usage_key, used, reference)
        _log_turn(m, "anthropic", ok, started)


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
    if not _llm_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No language-model provider key is configured")
    if body.messages[-1].role != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The last message must be yours")
    name = load_context(db, ctx.org_id).name
    msgs: list[dict] = [{"role": m.role, "content": m.text} for m in body.messages]
    if msgs[0]["role"] == "assistant":
        msgs.insert(0, {"role": "user", "content": "(Opened the setup assistant.)"})
    sctx = setup_agent.SetupContext(ctx.org_id, ctx.user.id)

    def run(tdb, tool, args):
        ok, out = setup_agent.run_tool(tdb, sctx, tool, args)
        return ok, out, out[:300]

    system = setup_agent.system_prompt(name)
    allowance = turn_allowance(system, setup_agent.TOOLS, msgs)
    budget_mod.reserve(db, ctx.org_id, UsageKind.llm_tokens, allowance, f"setup-{body.request_id}")
    gen = _llm_stream(
        system=system,
        tools=setup_agent.TOOLS,
        msgs=msgs,
        run=run,
        org_id=ctx.org_id,
        user_id=ctx.user.id,
        usage_key=f"setup-{body.request_id}",
        reference="setup assistant",
        reserved=allowance,
    )
    return StreamingResponse(gen, media_type="text/event-stream", headers={"cache-control": "no-store"})


@router.post("/tts")
def tts(body: TtsIn, ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))], db: DB) -> StreamingResponse:
    """Synthesises one sentence as MP3. Characters are checked against the caps and recorded
    atomically before the call (conservative: a failed call still counts)."""
    if not _tts_ready():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No text-to-speech provider key is configured")
    budget_mod.charge(
        db, ctx.org_id, UsageKind.tts_characters, len(body.text), f"tts-{body.request_id}", "voice lab tts"
    )
    http = providers.tts_http()  # shared and reused across sentences; only the response is closed here
    started = time.monotonic()
    try:
        r = http.send(providers.tts_request(http, body.text), stream=True)
    except Exception:
        log.warning("tts provider unreachable", extra={"chars": len(body.text)})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach the text-to-speech provider") from None
    if r.status_code != 200:
        r.close()
        log.warning("tts provider error", extra={"status": r.status_code})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Text-to-speech provider error (HTTP {r.status_code})")
    headers_ms = int((time.monotonic() - started) * 1000)

    def chunks() -> Iterator[bytes]:
        first_byte_ms: int | None = None
        sent = 0
        complete = False
        try:
            for chunk in r.iter_bytes():
                if first_byte_ms is None:
                    first_byte_ms = int((time.monotonic() - started) * 1000)
                sent += len(chunk)
                yield chunk
            complete = True
        finally:
            r.close()  # also runs when the browser stops listening (barge-in), freeing the connection
            log.info(
                "tts request",
                extra={
                    "metrics": {
                        "chars": len(body.text),
                        "headers_ms": headers_ms,
                        "first_byte_ms": first_byte_ms,
                        "bytes": sent,
                        "complete": complete,
                        "clients_created": providers.CLIENTS_CREATED["tts_http"],
                    }
                },
            )

    return StreamingResponse(chunks(), media_type="audio/mpeg", headers={"cache-control": "no-store"})
