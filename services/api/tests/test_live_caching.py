"""Phase 2 step 1: prompt caching, per-turn metrics and shared provider connections."""

import json
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr

from app.config import get_settings
from app.live import providers
from app.live.receptionist import BusinessContext, system_prompt
from app.routers.live import system_blocks

from .test_live import brain_body, events, live, setup_business, sse  # noqa: F401  (live is a fixture)
from .test_live_openai import text

# ---------- prompt caching ----------


def test_clock_goes_after_the_cache_breakpoint():
    stable, clock = system_blocks("Be kind.\n\nIt is now Monday 9 November 2026, 10:15 (Europe/London).")
    assert stable == {"type": "text", "text": "Be kind.", "cache_control": {"type": "ephemeral"}}
    assert clock == {"type": "text", "text": "It is now Monday 9 November 2026, 10:15 (Europe/London)."}
    # A prompt without a clock (the setup assistant) is cached whole.
    assert system_blocks("Help set up the business.") == [
        {"type": "text", "text": "Help set up the business.", "cache_control": {"type": "ephemeral"}}
    ]


def test_cached_prefix_is_identical_at_different_times():
    ctx = BusinessContext(name="Halden & Rye", greeting="Thanks for calling Halden & Rye.", disclosure=None)
    morning = system_blocks(system_prompt(ctx, datetime(2026, 11, 9, 9, 0, tzinfo=UTC)))
    later = system_blocks(system_prompt(ctx, datetime(2026, 11, 9, 16, 47, tzinfo=UTC)))
    assert morning[0] == later[0]  # the cached part never changes with the clock
    assert morning[1] != later[1] and "16:47" in later[1]["text"]
    assert "It is now" not in morning[0]["text"]


def _message_with_cache(text_out: str, inp: int, read: int, write: int, out: int) -> bytes:
    usage = {
        "input_tokens": inp,
        "output_tokens": 1,
        "cache_read_input_tokens": read,
        "cache_creation_input_tokens": write,
    }
    return sse(
        {
            "type": "message_start",
            "message": {
                "id": "msg_c",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-5-5",
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": usage,
            },
        },
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text_out}},
        {"type": "content_block_stop", "index": 0},
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": out},
        },
        {"type": "message_stop"},
    )


def test_cache_hits_are_reported_and_still_counted_against_the_cap(make_account, live):  # noqa: F811
    a = make_account("ada@example.com")
    setup_business(a)
    live["llm"] = [(200, _message_with_cache("Hello, Halden & Rye.", inp=120, read=2400, write=0, out=9))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    done = ev[-1]
    assert done["type"] == "done"
    m = done["metrics"]
    assert (m["rounds"], m["input_tokens"], m["cache_read_tokens"], m["cache_write_tokens"], m["output_tokens"]) == (
        1,
        120,
        2400,
        0,
        9,
    )
    assert isinstance(m["first_text_ms"], int) and m["first_text_ms"] >= 0
    # The monthly cap counts provider units conservatively: cached tokens are still tokens processed.
    assert done["llm_tokens"] == 120 + 2400 + 9


def test_openai_compatible_cached_tokens_are_reported(make_account, monkeypatch):
    s = get_settings()
    for k, v in {
        "llm_provider": "groq",
        "llm_api_key": SecretStr("gsk-test"),
        "llm_model": "qwen-test",
        "anthropic_api_key": None,
        "live_llm_tokens_per_org_month": 100_000,
        "live_llm_tokens_global_month": 1_000_000,
    }.items():
        monkeypatch.setattr(s, k, v)
    usage = {
        "prompt_tokens": 1000,
        "completion_tokens": 20,
        "total_tokens": 1020,
        "prompt_tokens_details": {"cached_tokens": 600},
    }
    body = "".join(f"data: {json.dumps(o)}\n\n" for o in [*text("Hello!"), {"choices": [], "usage": usage}])
    body += "data: [DONE]\n\n"

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(providers, "openai_http", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    a = make_account("ada@example.com")
    setup_business(a)
    done = events(a.post(a.o("/live/brain"), json=brain_body()))[-1]
    assert done["metrics"]["cache_read_tokens"] == 600
    assert done["metrics"]["input_tokens"] == 400 and done["metrics"]["output_tokens"] == 20


# ---------- shared provider connections ----------


@pytest.fixture
def fresh_clients():
    for f in (providers.tts_http, providers.openai_http, providers._anthropic):
        f.cache_clear()
    yield
    for f in (providers.tts_http, providers.openai_http, providers._anthropic):
        f.cache_clear()


def test_each_provider_client_is_created_once_per_process(monkeypatch, fresh_clients):
    before = dict(providers.CLIENTS_CREATED)
    assert providers.tts_http() is providers.tts_http()
    assert providers.openai_http() is providers.openai_http()
    monkeypatch.setattr(get_settings(), "anthropic_api_key", SecretStr("sk-one"))
    one = providers.llm_client()
    assert providers.llm_client() is one
    monkeypatch.setattr(get_settings(), "anthropic_api_key", SecretStr("sk-two"))
    assert providers.llm_client() is not one  # a rotated key gets its own client
    created = {k: providers.CLIENTS_CREATED[k] - before[k] for k in before}
    assert created == {"tts_http": 1, "openai_http": 1, "anthropic": 2}


class _Body(httpx.SyncByteStream):
    """A streamed provider body that records whether it was closed (connection released)."""

    def __init__(self, parts: list[bytes], log: list[str]) -> None:
        self.parts, self.log = parts, log

    def __iter__(self):
        yield from self.parts

    def close(self) -> None:
        self.log.append("closed")


def test_tts_reuses_one_client_and_releases_each_response(make_account, live, monkeypatch):  # noqa: F811
    closes: list[str] = []
    replies = [200, 200, 500]

    def handler(req: httpx.Request) -> httpx.Response:
        status = replies.pop(0)
        if status != 200:
            return httpx.Response(status, stream=_Body([b"{}"], closes))
        return httpx.Response(200, stream=_Body([b"ID3", b"audio"], closes), headers={"content-type": "audio/mpeg"})

    shared = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(providers, "tts_http", lambda: shared)
    a = make_account("ada@example.com")
    for i in range(2):
        r = a.post(a.o("/live/tts"), json={"request_id": f"tts-000{i}-share", "text": "Hello there."})
        assert r.status_code == 200 and r.content == b"ID3audio"
    bad = a.post(a.o("/live/tts"), json={"request_id": "tts-0003-share", "text": "Hello there."})
    assert bad.status_code == 502
    assert closes == ["closed", "closed", "closed"]  # every response released, including the failed one
    assert not shared.is_closed  # the shared client stays open for the next sentence


def test_metrics_reach_the_json_log_and_nothing_else_does():
    import logging

    from app.logging_setup import JsonFormatter

    rec = logging.LogRecord("voxera.live", logging.INFO, __file__, 1, "llm turn", None, None)
    rec.metrics = {"rounds": 2, "cache_read_tokens": 2400, "first_text_ms": 640}
    rec.transcript = "the caller's words"  # not on the allow-list: must never be logged
    out = json.loads(JsonFormatter().format(rec))
    assert out["metrics"] == {"rounds": 2, "cache_read_tokens": 2400, "first_text_ms": 640}
    assert "transcript" not in out
