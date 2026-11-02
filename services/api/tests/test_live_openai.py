"""The OpenAI-compatible brain (Groq, Gemini, OpenRouter, Ollama…), faked at the HTTP layer."""

import json

import httpx
import pytest
from pydantic import SecretStr

from app.config import get_settings
from app.live import providers, receptionist, setup_agent
from app.routers.live import _HideThinking

from .test_live import brain_body, events, setup_business


def chunks(*objs: dict, usage: int | None = None) -> bytes:
    out = [f"data: {json.dumps(o)}\n\n" for o in objs]
    if usage is not None:
        out.append(f"data: {json.dumps({'choices': [], 'usage': {'total_tokens': usage}})}\n\n")
    out.append("data: [DONE]\n\n")
    return "".join(out).encode()


def text(*parts: str) -> list[dict]:
    return [{"choices": [{"index": 0, "delta": {"content": p}}]} for p in parts] + [
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
    ]


def tool_call(name: str, args: str = "{}") -> list[dict]:
    first = {"index": 0, "id": "call_a1", "type": "function", "function": {"name": name, "arguments": ""}}
    return [
        {"choices": [{"index": 0, "delta": {"tool_calls": [first]}}]},
        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": args}}]}}]},
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
    ]


@pytest.fixture
def oa(monkeypatch):
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
    state: dict = {"replies": [], "requests": []}

    def handler(req: httpx.Request) -> httpx.Response:
        state["requests"].append(req)
        status, body = state["replies"].pop(0)
        return httpx.Response(status, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(providers, "openai_http", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    return state


def test_groq_brain_runs_tools_streams_and_meters(make_account, oa):
    a = make_account("ada@example.com")
    setup_business(a)
    oa["replies"] = [
        (200, chunks(*tool_call("list_services"), usage=800)),
        (200, chunks(*text("Balayage starts ", "from £165."), usage=900)),
    ]
    status = a.get(a.o("/live/status")).json()["llm"]
    assert (status["available"], status["provider"], status["model"]) == (True, "Groq", "qwen-test")

    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool", "text", "text", "done"]
    assert ev[0] == {"type": "tool", "name": "list_services", "ok": True, "result": "workspace data returned"}
    assert "".join(e["text"] for e in ev if e["type"] == "text") == "Balayage starts from £165."
    assert ev[-1]["llm_tokens"] == 1700

    first, second = (json.loads(r.content) for r in oa["requests"])
    req = oa["requests"][0]
    assert str(req.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer gsk-test"
    assert (
        first["model"] == "qwen-test" and first["stream"] is True and first["stream_options"] == {"include_usage": True}
    )
    assert first["messages"][0]["role"] == "system" and "999" in first["messages"][0]["content"]
    assert {t["function"]["name"] for t in first["tools"]} == {t["name"] for t in receptionist.TOOLS}
    # The tool round: the assistant's call, then the result, as OpenAI-style messages.
    call, result = second["messages"][-2:]
    assert call["tool_calls"][0] == {
        "id": "call_a1",
        "type": "function",
        "function": {"name": "list_services", "arguments": "{}"},
    }
    assert result["role"] == "tool" and result["tool_call_id"] == "call_a1"
    assert json.loads(result["content"])[0]["price_from_gbp"] == "165.00"
    assert a.get(a.o("/live/status")).json()["llm"]["org_used"] == 1700


def test_estimates_tokens_when_the_provider_sends_no_counts(make_account, oa, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "gemini")
    a = make_account("ada@example.com")
    oa["replies"] = [(200, chunks(*text("Hello!")))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert ev[-1]["type"] == "done" and ev[-1]["llm_tokens"] > 1000  # the prompt and tools alone are thousands of chars
    req = oa["requests"][0]
    assert str(req.url) == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert "stream_options" not in json.loads(req.content)


def test_errors_become_error_events(make_account, oa):
    a = make_account("ada@example.com")
    oa["replies"] = [(429, b'{"error": "slow down"}')]
    assert events(a.post(a.o("/live/brain"), json=brain_body())) == [
        {"type": "error", "message": "Language model is rate limited."}
    ]
    oa["replies"] = [(500, b"{}")]
    assert events(a.post(a.o("/live/brain"), json=brain_body())) == [
        {"type": "error", "message": "Language model error (HTTP 500)."}
    ]
    # Invalid JSON arguments: nothing runs, the model is told why and answers instead.
    oa["replies"] = [
        (200, chunks(*tool_call("list_services", '{"oops"'))),
        (200, chunks(*text("Sorry, let me check that another way."))),
    ]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool", "text", "done"]
    assert ev[0]["ok"] is False and "not valid JSON" in ev[0]["result"]
    told = json.loads(oa["requests"][-1].content)["messages"][-1]
    assert told["role"] == "tool" and "nothing was done" in told["content"]


def test_setup_assistant_works_through_the_same_provider(make_account, oa):
    a = make_account("ada@example.com", "EW Saloon")
    assert a.get(a.o("/live/setup-assistant/status")).json() == {"ai": True}
    oa["replies"] = [(200, chunks(*text("Hi! What kind of business is EW Saloon?")))]
    ev = events(
        a.post(
            a.o("/live/setup-assistant"),
            json={"request_id": "setup-0001-abcd", "messages": [{"role": "user", "text": "hi"}]},
        )
    )
    assert [e["type"] for e in ev] == ["text", "done"]
    body = json.loads(oa["requests"][0].content)
    assert {t["function"]["name"] for t in body["tools"]} == {t["name"] for t in setup_agent.TOOLS}


def test_needs_a_model_and_a_key(make_account, oa, monkeypatch):
    a = make_account("ada@example.com")
    s = get_settings()
    monkeypatch.setattr(s, "llm_model", None)
    assert a.get(a.o("/live/status")).json()["llm"] == {
        **a.get(a.o("/live/status")).json()["llm"],
        "available": False,
        "model": "not set",
    }
    assert a.post(a.o("/live/brain"), json=brain_body()).status_code == 503
    monkeypatch.setattr(s, "llm_model", "qwen3.5:27b")
    monkeypatch.setattr(s, "llm_api_key", None)
    assert not providers.llm_ready()
    monkeypatch.setattr(s, "llm_provider", "ollama")  # a local Ollama needs no key
    assert providers.llm_ready()
    assert providers.openai_request(httpx.Client(), {}).url == "http://localhost:11434/v1/chat/completions"


def test_gemini_gets_the_schema_dialect_it_accepts():
    tools = providers.openai_tools(setup_agent.TOOLS, "gemini")

    def walk(node):
        if isinstance(node, dict):
            assert "additionalProperties" not in node and "strict" not in node
            assert not isinstance(node.get("type"), list) and None not in (node.get("enum") or [])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk([t["function"].get("parameters") for t in tools])
    biz = next(t for t in tools if t["function"]["name"] == "update_business_details")["function"]["parameters"]
    assert biz["properties"]["phone"] == {"type": "string", "nullable": True}
    assert (
        None not in biz["properties"]["business_type"]["enum"]
        and "barbershop" in biz["properties"]["business_type"]["enum"]
    )
    state = next(t for t in tools if t["function"]["name"] == "get_setup_state")["function"]
    assert "parameters" not in state  # Gemini rejects an object with no properties
    # Other providers get the schemas unchanged.
    groq = providers.openai_tools(setup_agent.TOOLS, "groq")
    assert groq[1]["function"]["parameters"] == setup_agent.TOOLS[1]["input_schema"]


def test_reasoning_text_is_hidden():
    h = _HideThinking()
    out = "".join(h.feed(p) for p in ["<thi", "nk>The caller wants", " prices</th", "ink>Balayage is ", "£165."])
    assert out == "Balayage is £165."
    assert _HideThinking().feed("No tags here.") == "No tags here."
