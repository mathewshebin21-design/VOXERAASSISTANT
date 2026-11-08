"""LiveKit Agents adapter (prototype, ADR-0005). Requires the ``livekit`` extra.

LiveKit owns the media path: room audio, voice-activity and end-of-turn detection, streaming
speech recognition and speech output, and barge-in. VOXERA replaces only the reasoning step:
``VoxeraAgent.llm_node`` sends the caller's turn to the VOXERA brain through ``CallSession`` and
yields its reply text. When the caller interrupts, LiveKit cancels this generator, which closes the
brain request.

Speech providers are NOT chosen here. They come from VOXERA's route for the call's language
(``POST /v1/orgs/{org}/voice/route``) and need paid keys, so nothing below starts unless an operator
configures them. Running a room needs a LiveKit server (LiveKit Cloud or self-hosted): neither is
provisioned, and doing so needs the owner's approval (ADR-0005 §4).

    VOXERA_API_URL=… VOXERA_ORG_ID=… VOXERA_BRAIN_TOKEN=… python -m voxera_worker.livekit_agent dev
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, ModelSettings, WorkerOptions, cli, llm

from .brain import BrainClient
from .session import CallSession, LanguageGate

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


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    brain = BrainClient(os.environ["VOXERA_API_URL"], os.environ["VOXERA_ORG_ID"], os.environ["VOXERA_BRAIN_TOKEN"])
    accepted = tuple(os.environ.get("VOXERA_LANGUAGES", "en-GB").split(","))
    call = CallSession(brain, language=LanguageGate(accepted=accepted, current=accepted[0]))
    session = AgentSession()  # STT/TTS/VAD come from the approved provider configuration (not set here)
    await session.start(agent=VoxeraAgent(call), room=ctx.room)
    ctx.add_shutdown_callback(lambda: _log_summary(call))


async def _log_summary(call: CallSession) -> None:
    log.info("call ended", extra={"metrics": call.summary()})


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
