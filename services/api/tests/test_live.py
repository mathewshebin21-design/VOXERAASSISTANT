"""Live provider endpoints, with the Anthropic and ElevenLabs HTTP APIs faked at the transport layer."""

import json

import anthropic
import httpx
import httpx2
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.config import get_settings
from app.live import providers

from .conftest import join


def sse(*events: dict) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def message(blocks: list[tuple[str, dict]], stop: str, inp: int, out: int) -> bytes:
    evs: list[dict] = [
        {
            "type": "message_start",
            "message": {
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-5-5",
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": inp, "output_tokens": 1},
            },
        }
    ]
    for i, (kind, data) in enumerate(blocks):
        if kind == "text":
            evs += [{"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}}]
            evs += [
                {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": t}}
                for t in data["parts"]
            ]
        else:
            evs += [
                {
                    "type": "content_block_start",
                    "index": i,
                    "content_block": {"type": "tool_use", "id": data["id"], "name": data["name"], "input": {}},
                },
                {
                    "type": "content_block_delta",
                    "index": i,
                    "delta": {"type": "input_json_delta", "partial_json": "{}"},
                },
            ]
        evs.append({"type": "content_block_stop", "index": i})
    evs += [
        {
            "type": "message_delta",
            "delta": {"stop_reason": stop, "stop_sequence": None},
            "usage": {"output_tokens": out},
        },
        {"type": "message_stop"},
    ]
    return sse(*evs)


@pytest.fixture
def live(monkeypatch):
    """Configures fake keys and caps, and routes provider HTTP to scripted responses."""
    s = get_settings()
    for k, v in {
        "anthropic_api_key": SecretStr("sk-test"),
        "elevenlabs_api_key": SecretStr("xi-test"),
        "elevenlabs_voice_id": "voice123",
        "live_llm_tokens_per_org_month": 100_000,
        "live_llm_tokens_global_month": 1_000_000,
        "live_tts_chars_per_org_month": 1000,
        "live_tts_chars_global_month": 10_000,
    }.items():
        monkeypatch.setattr(s, k, v)
    state = {"llm": [], "llm_requests": [], "tts": [], "tts_requests": []}

    def llm_handler(req: httpx2.Request) -> httpx2.Response:
        state["llm_requests"].append(req)
        status, body = state["llm"].pop(0)
        return httpx2.Response(
            status, content=body, headers={"content-type": "text/event-stream" if status == 200 else "application/json"}
        )

    def tts_handler(req: httpx.Request) -> httpx.Response:
        state["tts_requests"].append(req)
        status, body = state["tts"].pop(0)
        return httpx.Response(status, content=body, headers={"content-type": "audio/mpeg"})

    monkeypatch.setattr(
        providers,
        "llm_client",
        lambda: anthropic.Anthropic(
            api_key="sk-test",
            max_retries=0,
            http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(llm_handler)),
        ),
    )
    monkeypatch.setattr(providers, "tts_http", lambda: httpx.Client(transport=httpx.MockTransport(tts_handler)))
    return state


def events(resp) -> list[dict]:
    return [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]


def setup_business(a):
    assert a.put(a.o("/business-profile"), json={"display_name": "Halden & Rye", "city": "Bristol"}).status_code == 200
    a.post(a.o("/services"), json={"name": "Balayage", "duration_min": 180, "price_from_pence": 16500})


BRAIN = {
    "request_id": "turn-0001-abcd",
    "messages": [
        {"role": "assistant", "text": "Hello, I'm the AI receptionist."},
        {"role": "user", "text": "How much is balayage?"},
    ],
}


def test_switched_off_without_keys_or_caps(make_account, monkeypatch):
    a = make_account("ada@example.com")
    st = a.get(a.o("/live/status")).json()
    assert st["llm"]["available"] is False and st["tts"]["available"] is False
    assert a.post(a.o("/live/brain"), json=BRAIN).status_code == 503
    assert a.post(a.o("/live/tts"), json={"request_id": "tts-0001-abc", "text": "Hi"}).status_code == 503
    monkeypatch.setattr(get_settings(), "anthropic_api_key", SecretStr("sk-test"))  # key but no cap
    r = a.post(a.o("/live/brain"), json=BRAIN)
    assert r.status_code == 503 and "cap" in r.json()["detail"]


def test_brain_streams_runs_tools_on_workspace_data_and_meters(make_account, live, owner_engine):
    a = make_account("ada@example.com")
    setup_business(a)
    live["llm"] = [
        (200, message([("tool", {"id": "toolu_1", "name": "list_services"})], "tool_use", 900, 30)),
        (200, message([("text", {"parts": ["Balayage starts ", "from £165."]})], "end_turn", 1000, 12)),
    ]
    r = a.post(a.o("/live/brain"), json=BRAIN)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = events(r)
    assert [e["type"] for e in ev] == ["tool", "text", "text", "done"]
    assert ev[0] == {"type": "tool", "name": "list_services", "ok": True, "result": "workspace data returned"}
    assert ev[-1]["llm_tokens"] == 900 + 30 + 1000 + 12

    first, second = (json.loads(q.content) for q in live["llm_requests"])
    hdr = live["llm_requests"][0].headers
    assert (
        "sk-test" in (hdr.get("x-api-key", "") + hdr.get("authorization", ""))
        and "server-side-fallback-2026-07-01" in hdr["anthropic-beta"]
    )
    assert first["model"] == "claude-opus-5-5" and first["fallbacks"] == "default"
    assert first["output_config"] == {"effort": "low"} and "temperature" not in first
    assert "Halden & Rye" in first["system"] and "999" in first["system"]
    assert first["messages"][0]["role"] == "user"  # synthetic opener before the greeting
    assert {t["name"] for t in first["tools"]} == {"get_business_info", "get_opening_hours", "list_services"}
    result = second["messages"][-1]["content"][0]
    assert result["type"] == "tool_result" and json.loads(result["content"])[0]["price_from_gbp"] == "165.00"

    with owner_engine.connect() as c:
        row = c.execute(
            text("SELECT kind, source, quantity, idempotency_key FROM usage_events WHERE kind = 'llm_tokens'")
        ).one()
    assert (row.kind, row.source, int(row.quantity), row.idempotency_key) == (
        "llm_tokens",
        "live",
        1942,
        "llm-turn-0001-abcd",
    )
    assert a.get(a.o("/live/status")).json()["llm"]["org_used"] == 1942


def test_provider_error_becomes_an_error_event(make_account, live):
    a = make_account("ada@example.com")
    live["llm"] = [
        (529, json.dumps({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}).encode())
    ]
    ev = events(a.post(a.o("/live/brain"), json=BRAIN))
    assert ev == [{"type": "error", "message": "Language model error (HTTP 529)."}]


def test_brain_validation_and_caps(make_account, live, monkeypatch):
    a = make_account("ada@example.com")
    assert a.post(a.o("/live/brain"), json={**BRAIN, "messages": BRAIN["messages"][:1]}).status_code == 422
    assert a.post(a.o("/live/brain"), json={**BRAIN, "messages": [{"role": "system", "text": "x"}]}).status_code == 422
    assert (
        a.post(a.o("/live/brain"), json={**BRAIN, "messages": [{"role": "user", "text": "x" * 2001}]}).status_code
        == 422
    )
    monkeypatch.setattr(get_settings(), "live_llm_tokens_per_org_month", 500)
    r = a.post(a.o("/live/brain"), json=BRAIN)
    assert r.status_code == 429 and live["llm_requests"] == []


def test_global_cap_spans_workspaces(make_account, live, monkeypatch):
    a = make_account("ada@example.com")
    b = make_account("bo@example.com", "Other")
    monkeypatch.setattr(get_settings(), "live_tts_chars_global_month", 10)
    live["tts"] = [(200, b"ID3audio")]
    assert a.post(a.o("/live/tts"), json={"request_id": "tts-0001-abc", "text": "Hello there"}).status_code == 429
    assert a.post(a.o("/live/tts"), json={"request_id": "tts-0002-abc", "text": "Hello"}).status_code == 200
    r = b.post(b.o("/live/tts"), json={"request_id": "tts-0003-abc", "text": "Hiya!!"})
    assert r.status_code == 429  # org B is blocked by org A's usage, without seeing A's rows


def test_tts_streams_audio_and_meters_characters(make_account, live, owner_engine):
    a = make_account("ada@example.com")
    live["tts"] = [(200, b"ID3-fake-mp3-bytes"), (401, b'{"detail":"bad key"}')]
    r = a.post(a.o("/live/tts"), json={"request_id": "tts-0001-abc", "text": "Hello, Halden and Rye."})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3-fake-mp3-bytes"
    req = live["tts_requests"][0]
    assert req.url.path == "/v1/text-to-speech/voice123/stream" and req.url.params["output_format"] == "mp3_44100_128"
    assert req.headers["xi-api-key"] == "xi-test" and json.loads(req.content) == {
        "text": "Hello, Halden and Rye.",
        "model_id": "eleven_flash_v2_5",
    }
    assert a.post(a.o("/live/tts"), json={"request_id": "tts-0002-abc", "text": "Again"}).status_code == 502
    with owner_engine.connect() as c:
        assert (
            c.execute(text("SELECT sum(quantity) FROM usage_events WHERE kind = 'tts_characters'")).scalar() == 22 + 5
        )


def test_roles_and_isolation(make_account, live):
    owner = make_account("ada@example.com")
    viewer = make_account("vic@example.com", "Vic")
    join(owner, viewer, "viewer")
    viewer.org_id = owner.org_id
    assert viewer.get(viewer.o("/live/status")).status_code == 200
    assert viewer.post(viewer.o("/live/brain"), json=BRAIN).status_code == 403
    assert viewer.post(viewer.o("/live/tts"), json={"request_id": "tts-0001-abc", "text": "Hi"}).status_code == 403
    other = make_account("olu@example.com", "Elsewhere")
    assert other.post(f"/v1/orgs/{owner.org_id}/live/brain", json=BRAIN).status_code == 404
    assert "sk-test" not in owner.get(owner.o("/live/status")).text


def test_greeting_uses_saved_agent_and_disclosure(make_account):
    a = make_account("ada@example.com")
    a.post(a.o("/agents"), json={"name": "Rye", "greeting": "Hello, I'm Rye, the AI receptionist for the salon."})
    t = a.get(a.o("/live/greeting")).json()["text"]
    assert t.startswith("Hello, I'm Rye, the AI receptionist") and "recorded" in t


def test_cheaper_model_without_fallback_support(make_account, live, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_model", "claude-haiku-5-5")
    a = make_account("ada@example.com")
    live["llm"] = [(200, message([("text", {"parts": ["Hello."]})], "end_turn", 10, 2))]
    assert [e["type"] for e in events(a.post(a.o("/live/brain"), json=BRAIN))] == ["text", "done"]
    body = json.loads(live["llm_requests"][0].content)
    assert body["model"] == "claude-haiku-5-5" and "fallbacks" not in body
    assert "server-side-fallback" not in live["llm_requests"][0].headers.get("anthropic-beta", "")
