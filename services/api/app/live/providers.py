"""Clients for the paid providers. Tests replace these factories with fakes."""

import anthropic
import httpx

from ..config import get_settings


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
