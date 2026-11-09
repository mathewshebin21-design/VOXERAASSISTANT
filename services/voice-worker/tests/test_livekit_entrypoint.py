"""Offline LiveKit entrypoint rehearsal: no SIP trunk, provider credentials, audio, or API traffic.

The real LiveKit Agent class is imported, while the job context and media session are
test doubles. These checks verify the last mandatory phone authorization boundary:
a SIP participant must never reach AgentSession.start without a valid phone-channel
token AND an API-authorized call record. API JWT verification is represented by a
fake recorder returning an ID, not claimed to be exercised in this test.
"""

from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace

import pytest

pytest.importorskip("livekit.agents")

from voxera_worker import livekit_agent as worker  # noqa: E402
from voxera_worker.guard import SIP_KIND  # noqa: E402
from voxera_worker.session import CallSession  # noqa: E402


def token(mode: str, channel: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"mode": mode, "channel": channel}).encode()).decode().rstrip("=")
    return f"test.{payload}.sig"


class FakeContext:
    def __init__(self, kind: int, events: list[str]) -> None:
        self.room = SimpleNamespace(name="isolated-rehearsal-room")
        self.participant = SimpleNamespace(kind=kind)
        self.events = events
        self.shutdown_reason: str | None = None
        self.callbacks: list = []

    async def connect(self) -> None:
        self.events.append("connect")

    async def wait_for_participant(self):
        self.events.append("participant")
        return self.participant

    def shutdown(self, *, reason: str) -> None:
        self.events.append("shutdown")
        self.shutdown_reason = reason

    def add_shutdown_callback(self, callback) -> None:
        self.callbacks.append(callback)
        self.events.append("callback")


def setup(monkeypatch, *, mode: str, channel: str, kind: int, record_id: str | None):
    events: list[str] = []
    context = FakeContext(kind, events)
    recordings: list = []
    sessions: list = []
    monkeypatch.delenv("VOXERA_WORKER_TOKEN_CMD", raising=False)
    monkeypatch.setenv("VOXERA_WORKER_TOKEN", token(mode, channel))
    monkeypatch.setenv("VOXERA_SIP_ENABLED", "true")  # explicit opt-in for offline admission-path tests
    monkeypatch.setenv("VOXERA_MEDIA_ENABLED", "true")  # mocked; never reaches inference
    monkeypatch.setenv("VOXERA_MEDIA_PROVIDER", "livekit-inference")
    monkeypatch.setenv("VOXERA_STT_MODEL", "mock/stt-model")
    monkeypatch.setenv("VOXERA_TTS_MODEL", "mock/tts-model")
    monkeypatch.setenv("VOXERA_TTS_VOICE", "offline-voice")
    monkeypatch.setenv("VOXERA_API_URL", "http://isolated-api.test")
    monkeypatch.setenv("VOXERA_LANGUAGES", "en-GB,hi-IN")

    class Recorder:
        def __init__(self, api, tokens):
            assert api == "http://isolated-api.test"
            self.tokens = tokens
            self.ends: list[tuple] = []
            recordings.append(self)

        async def start(self, **kwargs):
            events.append("record")
            assert kwargs["ai_disclosure_played"] is False
            assert kwargs["recording_notice_played"] is False
            assert kwargs["external_ref"].startswith("room-")
            return record_id

        async def end(self, *args):
            self.ends.append(args)
            events.append("record_end")

    class MediaSession:
        def __init__(self):
            sessions.append(self)

        async def start(self, *, agent, room):
            assert isinstance(agent.call, CallSession)
            assert room is context.room
            events.append("media_start")

    monkeypatch.setattr(worker, "CallRecorder", Recorder)
    monkeypatch.setattr(worker, "build_media_session", lambda settings: MediaSession())
    return context, events, recordings, sessions


@pytest.mark.parametrize(
    ("mode", "channel"),
    [("test", "simulated"), ("live", "simulated"), ("test", "phone")],
)
async def test_sip_refuses_non_live_phone_token_before_any_record_or_speech(monkeypatch, mode, channel):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode=mode, channel=channel, kind=SIP_KIND, record_id="would-not-be-used"
    )
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "worker channel mismatch"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == [] and ctx.callbacks == []


async def test_sip_refuses_even_valid_channel_when_api_denies_call_start(monkeypatch):
    ctx, events, recordings, sessions = setup(monkeypatch, mode="live", channel="phone", kind=SIP_KIND, record_id=None)
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "telephone authorization failed"
    assert events == ["connect", "participant", "record", "shutdown"]
    assert len(recordings) == 1 and sessions == [] and ctx.callbacks == []


async def test_sip_starts_media_only_after_api_authorized_call_record(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="live", channel="phone", kind=SIP_KIND, record_id="verified-call-id"
    )
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason is None
    assert events == ["connect", "participant", "record", "media_start", "callback"]
    assert len(recordings) == len(sessions) == len(ctx.callbacks) == 1
    await ctx.callbacks[0]()
    assert events[-1] == "record_end"


async def test_non_sip_participant_cannot_use_phone_credential(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="live", channel="phone", kind=0, record_id="would-not-be-used"
    )
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "worker channel mismatch"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == [] and ctx.callbacks == []


async def test_simulated_participant_may_start_without_record_on_best_effort_path(monkeypatch):
    ctx, events, recordings, sessions = setup(monkeypatch, mode="test", channel="simulated", kind=0, record_id=None)
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason is None
    assert events == ["connect", "participant", "record", "media_start", "callback"]
    assert len(recordings) == len(sessions) == 1


@pytest.mark.parametrize("error_type", [RuntimeError, asyncio.CancelledError])
async def test_media_startup_failure_marks_authorized_phone_call_failed_and_shuts_down(monkeypatch, error_type):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="live", channel="phone", kind=SIP_KIND, record_id="verified-call-id"
    )

    class FailingMediaSession:
        def __init__(self):
            sessions.append(self)

        async def start(self, *, agent, room):
            events.append("media_start")
            raise error_type("simulated media startup failure")

    monkeypatch.setattr(worker, "build_media_session", lambda settings: FailingMediaSession())
    with pytest.raises(error_type):
        await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "media startup failed"
    assert events == ["connect", "participant", "record", "media_start", "record_end", "shutdown"]
    assert len(recordings) == len(sessions) == 1
    assert recordings[0].ends == [("failed", None, "media startup failed")]
    assert ctx.callbacks == []  # startup never succeeded, so no later shutdown callback was registered


async def test_sip_is_disabled_by_default_even_with_live_phone_token_and_no_backend_calls(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="live", channel="phone", kind=SIP_KIND, record_id="would-not-be-used"
    )
    monkeypatch.delenv("VOXERA_SIP_ENABLED")
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "telephone channel disabled"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == [] and ctx.callbacks == []


async def test_sip_rejects_unapproved_flag_value(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="live", channel="phone", kind=SIP_KIND, record_id="would-not-be-used"
    )
    monkeypatch.setenv("VOXERA_SIP_ENABLED", "TRUE")
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "telephone channel disabled"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == []


async def test_disabled_speech_refuses_before_any_call_record_or_media(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="test", channel="simulated", kind=0, record_id="would-not-be-used"
    )
    monkeypatch.delenv("VOXERA_MEDIA_ENABLED")
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "speech media unavailable"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == [] and ctx.callbacks == []


async def test_missing_tts_model_refuses_before_call_record_or_media(monkeypatch):
    ctx, events, recordings, sessions = setup(
        monkeypatch, mode="test", channel="simulated", kind=0, record_id="would-not-be-used"
    )
    monkeypatch.delenv("VOXERA_TTS_MODEL")
    await worker.entrypoint(ctx)

    assert ctx.shutdown_reason == "speech media unavailable"
    assert events == ["connect", "participant", "shutdown"]
    assert recordings == [] and sessions == []
