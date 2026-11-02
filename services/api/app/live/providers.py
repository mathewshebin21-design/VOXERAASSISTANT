"""Clients for the AI and speech providers. Tests replace these factories with fakes."""

import copy

import anthropic
import httpx

from ..config import get_settings

# OpenAI-compatible chat endpoints. Each is free to try within its own limits; check the
# provider's terms before real customer data goes through it (see docs/phase-3-live-providers.md).
OPENAI_COMPATIBLE = {
    "groq": ("Groq", "https://api.groq.com/openai/v1"),
    "gemini": ("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1"),
    "ollama": ("Ollama (local)", "http://localhost:11434/v1"),
    "openai_compatible": ("OpenAI-compatible", ""),
}


def llm_label() -> str:
    s = get_settings()
    return "Anthropic" if s.llm_provider == "anthropic" else OPENAI_COMPATIBLE[s.llm_provider][0]


def llm_ready() -> bool:
    """Whether a language model is configured (caps are checked separately)."""
    s = get_settings()
    if s.llm_provider == "anthropic":
        return s.anthropic_api_key is not None
    has_url = bool(s.llm_base_url or OPENAI_COMPATIBLE[s.llm_provider][1])
    return bool(s.llm_model) and has_url and (s.llm_api_key is not None or s.llm_provider == "ollama")


def openai_http() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(30.0, connect=5.0))


def openai_request(client: httpx.Client, body: dict) -> httpx.Request:
    """A streamed chat-completions request to the configured OpenAI-compatible provider."""
    s = get_settings()
    base = (s.llm_base_url or OPENAI_COMPATIBLE[s.llm_provider][1]).rstrip("/")
    headers = {"content-type": "application/json", "accept": "text/event-stream"}
    if s.llm_api_key is not None:
        headers["authorization"] = f"Bearer {s.llm_api_key.get_secret_value()}"
    if s.llm_provider == "openrouter":
        headers["x-title"] = "VOXERA"
    return client.build_request("POST", f"{base}/chat/completions", headers=headers, json=body)


def openai_tools(tools: list[dict], provider: str) -> list[dict]:
    """Anthropic-style tool definitions as OpenAI function tools.

    Gemini's compatible endpoint takes a narrower schema dialect, so for it nullable unions
    ("type": ["string", "null"]) become "nullable": true, and keywords it rejects are dropped.
    """

    def gemini(node: object) -> object:
        if isinstance(node, list):
            return [gemini(x) for x in node]
        if not isinstance(node, dict):
            return node
        out = {k: gemini(v) for k, v in node.items() if k not in ("additionalProperties", "strict")}
        t = out.get("type")
        if isinstance(t, list):
            kinds = [x for x in t if x != "null"]
            out["type"] = kinds[0] if kinds else "string"
            if "null" in t:
                out["nullable"] = True
        if isinstance(out.get("enum"), list):
            out["enum"] = [x for x in out["enum"] if x is not None]
        return out

    result = []
    for tool in tools:
        params = copy.deepcopy(tool.get("input_schema") or {"type": "object", "properties": {}})
        fn: dict = {"name": tool["name"], "description": tool["description"]}
        if provider == "gemini":
            params = gemini(params)
            if not params.get("properties"):  # Gemini rejects an object with no properties
                result.append({"type": "function", "function": fn})
                continue
            if not params.get("required"):
                params.pop("required", None)
        result.append({"type": "function", "function": {**fn, "parameters": params}})
    return result


def llm_client() -> anthropic.Anthropic:
    s = get_settings()
    assert s.anthropic_api_key is not None
    # One retry only: on a phone call a slow retry is worse than the recovery line.
    return anthropic.Anthropic(
        api_key=s.anthropic_api_key.get_secret_value(),
        max_retries=1,
        timeout=anthropic.Timeout(30.0, connect=5.0),
    )


def tts_http() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0))


def tts_request(client: httpx.Client, text: str) -> httpx.Request:
    """ElevenLabs streaming text-to-speech (MP3)."""
    s = get_settings()
    assert s.elevenlabs_api_key is not None and s.elevenlabs_voice_id
    return client.build_request(
        "POST",
        f"{s.elevenlabs_base_url.rstrip('/')}/v1/text-to-speech/{s.elevenlabs_voice_id}/stream",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": s.elevenlabs_api_key.get_secret_value(), "accept": "audio/mpeg"},
        json={"text": text, "model_id": s.elevenlabs_model},
    )
