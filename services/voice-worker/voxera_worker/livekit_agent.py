"""LiveKit Agents adapter (prototype, ADR-0005). Requires the ``livekit`` extra.

LiveKit owns the media path: room audio, voice-activity and end-of-turn detection, streaming
speech recognition and speech output, and barge-in. VOXERA replaces only the reasoning step:
``VoxeraAgent.llm_node`` sends the caller's turn to the VOXERA brain through ``CallSession`` and
yields its reply text. When the caller interrupts, LiveKit cancels this generator, which closes the
brain request.

Speech recognition, voice synthesis, and voice-activity detection are selected only through
explicit model configuration (see media.py). This code does not enable any provider by default.
Voice choices are temporary staging configuration until workspace-level routing is approved.
Running a room needs an approved LiveKit server and paid-provider budget gate (ADR-0005 §4).

    VOXERA_API_URL=… VOXERA_WORKER_TOKEN_CMD="…/mint_worker_token.py --org <id>" \
        python -m voxera_worker.livekit_agent dev

``VOXERA_WORKER_TOKEN_CMD`` prints a fresh scoped worker token; the worker refreshes it before it
expires (tokens last at most 15 minutes). ``VOXERA_WORKER_TOKEN`` (a single token) is for short tests.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, ModelSettings, WorkerOptions, cli, inference, llm

from .brain import BrainClient
from .guard import CallBoundTokens, is_phone, may_answer
from .media import MediaConfigError, MediaSettings, speech_settings
from .recording import CallRecorder, room_ref
from .session import CallSession, LanguageGate
from .tokens import StaticToken, TokenSource, command_fetch

log = logging.getLogger("voxera.worker")

GREETING_INSTRUCTIONS = "You are VOXERA's receptionist. Replies come from the VOXERA brain."


def last_user_text(chat_ctx: llm.ChatContext) -> str:
    for item in reversed(chat_ctx.items):
        if getattr(item, "role", None) == "user":
            return (getattr(item, "text_content", None) or "").strip()
    return ""


class VoxeraAgent(Agent):
    def __init__(self, session: CallSession) -> None:
        super().__init__(instructions=GREETING_INSTRUCTIONS)
        self.call = session

    async def llm_node(  # type: ignore[override]
        self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings
    ) -> AsyncIterable[str]:
        said = last_user_text(chat_ctx)
        if not said:
            return
        # Language detection results come from the STT plugin's events; wiring them in is part of
        # the provider integration, so the prototype keeps the call in its current language.
        async for piece in self.call.reply(said):
            yield piece


def build_media_session(settings: MediaSettings) -> AgentSession:
    """Construct an explicit STT -> VOXERA brain -> TTS session without starting providers."""
    return AgentSession(
        stt=inference.STT(model=settings.stt_model),
        tts=inference.TTS(model=settings.tts_model, voice=settings.tts_voice),
        vad=inference.VAD(model="silero"),
    )


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    caller = await ctx.wait_for_participant()
    # An explicit, separate operational approval is needed even after the API's
    # country launch gate. Staging and all unconfigured workers refuse SIP.
    if is_phone(caller) and os.environ.get("VOXERA_SIP_ENABLED") != "true":
        log.warning("refusing telephone call: SIP disabled by operator")
        ctx.shutdown(reason="telephone channel disabled")
        return
    cmd = os.environ.get("VOXERA_WORKER_TOKEN_CMD")
    raw_tokens = TokenSource(command_fetch(cmd)) if cmd else StaticToken(os.environ["VOXERA_WORKER_TOKEN"])
    tokens = CallBoundTokens(raw_tokens, caller)
    try:
        await tokens.get()  # bind every token (including future refreshes) to the actual call channel
    except RuntimeError as e:
        log.warning("refusing call", extra={"reason": str(e)})
        ctx.shutdown(reason="worker channel mismatch")
        return
    # Validate before opening a call record: an unconfigured worker must not
    # admit a caller, create records, or silently trigger provider inference.
    try:
        media = speech_settings(os.environ)
    except MediaConfigError:
        log.warning("refusing call: speech media is not configured or approved")
        ctx.shutdown(reason="speech media unavailable")
        return
    api = os.environ["VOXERA_API_URL"]
    brain = BrainClient(api, "", tokens, worker=True)
    accepted = tuple(os.environ.get("VOXERA_LANGUAGES", "en-GB").split(","))
    call = CallSession(
        brain, language=LanguageGate(accepted=accepted, current=accepted[0]), recorder=CallRecorder(api, tokens)
    )
    # The prototype plays no AI-disclosure or recording notice yet, so it says so: the API then keeps
    # the call's events without the caller's words. The room name makes the record restart-safe.
    record_id = await call.begin(external_ref=room_ref(ctx.room.name))
    if not may_answer(caller, record_id):
        # For SIP this API round-trip is the mandatory signed-token and country-gate check.
        # Call recording stays best-effort for simulated/non-phone participants only.
        log.warning("refusing telephone call: API authorization or call start failed")
        ctx.shutdown(reason="telephone authorization failed")
        return
    # Once the API has authorized a phone call, the record must be closed even if
    # media initialization fails. Otherwise the call can remain open indefinitely.
    try:
        session = build_media_session(media)
        await session.start(agent=VoxeraAgent(call), room=ctx.room)
    except BaseException:  # also includes cancellation while a job is starting
        call.closed, call.close_reason = True, "media startup failed"
        try:
            await call.finish()
        finally:
            ctx.shutdown(reason="media startup failed")
        raise
    ctx.add_shutdown_callback(lambda: _close(call))


async def _close(call: CallSession) -> None:
    await call.finish()
    log.info("call ended", extra={"metrics": call.summary()})


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
