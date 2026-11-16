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

import asyncio
import logging
import os
from collections.abc import AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, ModelSettings, WorkerOptions, cli, inference, llm, room_io

from .brain import BrainClient
from .guard import CallBoundTokens, is_phone, may_answer, sip_ingress_refusal
from .lifetime import CallLifetime
from .media import MediaConfigError, MediaSettings, speech_settings
from .media_policy import fetch_authorized_languages
from .policy import PolicyUnavailable, called_number
from .recording import CallRecorder, room_ref
from .session import CallSession, LanguageGate
from .tokens import StaticToken, TokenSource, command_fetch
from .transcription_recovery import TranscriptionRecovery

log = logging.getLogger("voxera.worker")

GREETING_INSTRUCTIONS = "You are VOXERA's receptionist. Replies come from the VOXERA brain."

# Draft text only. Legal, language, and real-audio review is required before launch.
PHONE_NOTICES = (
    ("ai_disclosure", "Hello. You are speaking with an AI receptionist."),
    (
        "recording_notice",
        "This conversation may be transcribed and saved for the business to review. "
        "You can end the call if you prefer not to continue.",
    ),
)
NOTICE_TIMEOUT_SECONDS = 30.0


def last_user_text(chat_ctx: llm.ChatContext) -> str:
    for item in reversed(chat_ctx.items):
        if getattr(item, "role", None) == "user":
            return (getattr(item, "text_content", None) or "").strip()
    return ""


class VoxeraAgent(Agent):
    def __init__(self, session: CallSession, *, require_notices: bool = False) -> None:
        super().__init__(instructions=GREETING_INSTRUCTIONS)
        self.call = session
        self.require_notices = require_notices
        self.notices_complete = not require_notices

    async def llm_node(  # type: ignore[override]
        self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings
    ) -> AsyncIterable[str]:
        if self.require_notices and not self.notices_complete:
            return  # no model inference before the notice handshake
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
        transcription_timeout=4.0,
    )


async def _phone_notice_sequence(session: AgentSession, recorder: CallRecorder | None) -> bool:
    """Report completed SDK speech playout one notice at a time.

    SDK completion does NOT prove the remote caller heard the announcement.
    A real carrier loopback/recording acceptance test remains mandatory.
    """
    if recorder is None or recorder.call_id is None:
        return False
    for kind, notice in PHONE_NOTICES:
        handle = session.say(notice, allow_interruptions=False, add_to_chat_ctx=False)
        try:
            await asyncio.wait_for(handle.wait_for_playout(), timeout=NOTICE_TIMEOUT_SECONDS)
        except (RuntimeError, TimeoutError, OSError):
            return False
        if not handle.done() or handle.interrupted or handle.exception() is not None:
            return False
        if not await recorder.acknowledge_notice(kind):
            return False
    return True


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    caller = await ctx.wait_for_participant()
    # An explicit, separate operational approval is needed even after the API's
    # country launch gate. Staging and all unconfigured workers refuse SIP.
    if is_phone(caller) and os.environ.get("VOXERA_SIP_ENABLED") != "true":
        log.warning("refusing telephone call: SIP disabled by operator")
        ctx.shutdown(reason="telephone channel disabled")
        return
    ref = room_ref(ctx.room.name)
    if is_phone(caller) and ref is None:
        log.warning("refusing telephone call: no stable room reference")
        ctx.shutdown(reason="telephone reference unavailable")
        return
    cmd = os.environ.get("VOXERA_WORKER_TOKEN_CMD")
    # Every supervisor refresh receives the same room identifier, not a fresh
    # unbound workspace-wide token. The SIP participant and claim must match.
    raw_tokens = (
        TokenSource(command_fetch(cmd, call_ref=ref)) if cmd else StaticToken(os.environ["VOXERA_WORKER_TOKEN"])
    )
    tokens = CallBoundTokens(raw_tokens, caller, ref)
    try:
        await tokens.get()  # bind every token (including future refreshes) to the actual call channel
    except RuntimeError as e:
        log.warning("refusing call", extra={"reason": str(e)})
        ctx.shutdown(reason="worker channel mismatch")
        return
    if is_phone(caller):
        # A token with the right room and channel is not itself proof of an
        # approved inbound trunk. Refuse unknown dispatch, call ID or number
        # before any speech provider/policy request or call-record side effect.
        reason = sip_ingress_refusal(caller, called_number(caller))
        if reason is not None:
            log.warning("refusing unapproved SIP origin", extra={"reason": reason})
            ctx.shutdown(reason="unapproved SIP origin")
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
    # The same tenant-scoped policy authorizes languages AND exact STT/TTS models.
    # Missing provider attestations, paid consent, region or language evidence refuse
    # the call before a record or a media session is started.
    try:
        default, accepted = await fetch_authorized_languages(api, tokens, media)
    except PolicyUnavailable as e:
        log.warning("refusing call: voice policy unavailable", extra={"reason": str(e)})
        ctx.shutdown(reason="voice policy unavailable")
        return
    brain = BrainClient(api, "", tokens, worker=True)
    call = CallSession(
        brain, language=LanguageGate(accepted=accepted, current=default), recorder=CallRecorder(api, tokens)
    )
    if ref is not None:
        call.conversation_id = ref  # phone brain turn must match the signed call reference
    # The phone call starts without notice flags or transcript retention. Two
    # completed speech playout receipts are required before enabling microphone
    # input or brain inference. The room reference is restart-safe.
    record_id = await call.begin(external_ref=ref, called_number=called_number(caller) if is_phone(caller) else None)
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
        phone = is_phone(caller)
        agent = VoxeraAgent(call, require_notices=phone)
        if phone:
            await session.start(
                agent=agent,
                room=ctx.room,
                room_options=room_io.RoomOptions(audio_input=False, text_input=False, text_output=False),
                record=False,  # never save raw LiveKit audio or transcripts
            )
            if not await _phone_notice_sequence(session, call.recorder):
                call.closed, call.close_reason = True, "notice playback not confirmed"
                await call.finish()
                ctx.shutdown(reason="notice playback not confirmed")
                return
            agent.notices_complete = True
            session.input.set_audio_enabled(True)
        else:
            await session.start(agent=agent, room=ctx.room)
    except BaseException:  # also includes cancellation while a job is starting
        call.closed, call.close_reason = True, "media startup failed"
        try:
            await call.finish()
        finally:
            ctx.shutdown(reason="media startup failed")
        raise
    lifetime = CallLifetime(ctx, call)

    async def finish_call() -> None:
        await lifetime.stop()
        await _close(call)

    ctx.add_shutdown_callback(finish_call)
    TranscriptionRecovery(session, ctx, call)  # event callbacks retain this per-call observer


async def _close(call: CallSession) -> None:
    await call.finish()
    log.info("call ended", extra={"metrics": call.summary()})


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
