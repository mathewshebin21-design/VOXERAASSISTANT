"""Speech-provider configuration and LiveKit wiring: offline, no paid requests."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from voxera_worker.media import MediaConfigError, MediaSettings, speech_settings


@pytest.fixture
def enabled():
    return {
        "VOXERA_MEDIA_ENABLED": "true",
        "VOXERA_MEDIA_PROVIDER": "livekit-inference",
        "VOXERA_STT_MODEL": "deepgram/nova-3:multi",
        "VOXERA_TTS_MODEL": "cartesia/sonic-3",
        "VOXERA_TTS_VOICE": "fake-voice-001",
    }


def test_media_requires_explicit_models_and_voice(enabled):
    assert speech_settings(enabled) == MediaSettings(
        stt_model="deepgram/nova-3:multi",
        tts_model="cartesia/sonic-3",
        tts_voice="fake-voice-001",
    )


@pytest.mark.parametrize(
    ("setting", "value"),
    [
        ("VOXERA_MEDIA_ENABLED", "false"),
        ("VOXERA_MEDIA_ENABLED", "TRUE"),
        ("VOXERA_MEDIA_PROVIDER", "unsupported"),
        ("VOXERA_STT_MODEL", "http://example.invalid"),
        ("VOXERA_STT_MODEL", "supermodel"),
        ("VOXERA_STT_MODEL", "deepgram/model?token=secret"),
        ("VOXERA_TTS_MODEL", "openai/model with spaces"),
        ("VOXERA_TTS_MODEL", "https://example.invalid/model"),
        ("VOXERA_TTS_VOICE", ""),
        ("VOXERA_TTS_VOICE", "secret=not-a-voice"),
    ],
)
def test_invalid_config_is_rejected(enabled, setting, value):
    with pytest.raises(MediaConfigError):
        speech_settings({**enabled, setting: value})


@pytest.mark.parametrize(
    "missing",
    [
        "VOXERA_MEDIA_ENABLED",
        "VOXERA_MEDIA_PROVIDER",
        "VOXERA_STT_MODEL",
        "VOXERA_TTS_MODEL",
        "VOXERA_TTS_VOICE",
    ],
)
def test_incomplete_config_refused(enabled, missing):
    del enabled[missing]
    with pytest.raises(MediaConfigError):
        speech_settings(enabled)


def test_disabled_by_default():
    with pytest.raises(MediaConfigError, match="disabled"):
        speech_settings({})


def test_livekit_agent_session_has_stt_tts_vad_but_no_duplicate_llm(monkeypatch, enabled):
    pytest.importorskip("livekit.agents")
    from voxera_worker import livekit_agent as worker

    captured = {}

    def component(kind):
        def create(**kwargs):
            captured[kind] = kwargs
            return SimpleNamespace(kind=kind, **kwargs)

        return create

    monkeypatch.setattr(worker.inference, "STT", component("stt"))
    monkeypatch.setattr(worker.inference, "TTS", component("tts"))
    monkeypatch.setattr(worker.inference, "VAD", component("vad"))

    def session_factory(**kwargs):
        captured["session"] = kwargs
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(worker, "AgentSession", session_factory)
    settings = speech_settings(enabled)
    session = worker.build_media_session(settings)
    assert session.stt.model == settings.stt_model
    assert session.tts.model == settings.tts_model
    assert session.tts.voice == settings.tts_voice
    assert session.vad.model == "silero"
    assert "llm" not in captured["session"]  # VOXERA brain still provides the LLM node


async def test_real_livekit_media_session_constructs_without_starting_providers(monkeypatch, enabled):
    livekit_agents = pytest.importorskip("livekit.agents")
    from voxera_worker.livekit_agent import build_media_session

    # The real SDK checks for credentials during construction; these are dummy,
    # and the test neither starts a room nor makes an inference request.
    monkeypatch.setenv("LIVEKIT_URL", "wss://staging-livekit.example.test")
    monkeypatch.setenv("LIVEKIT_API_KEY", "offline-ci-not-a-real-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "offline-ci-not-a-real-secret")
    session = build_media_session(speech_settings(enabled))
    assert isinstance(session, livekit_agents.AgentSession)
