"""Fail-closed recovery for audio detected without any final STT transcript.

LiveKit emits user_transcription_timeout when VAD detects speech but STT
never produces a final transcript. This controller uses canned lines, never a
second LLM, and closes the call after two consecutive timeouts. It does not
store any caller audio or partial transcript.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .session import ENDED

log = logging.getLogger("voxera.worker.transcription")

REPEAT = "I'm sorry, I didn't catch that. Could you please repeat it?"
REASON = "speech transcription unavailable"


class TranscriptionRecovery:
    """Per-call observer. Reset the timeout count only on an actual final transcript."""

    def __init__(self, media: Any, ctx: Any, call: Any, *, closing_timeout: float = 3.0) -> None:
        self.media = media
        self.ctx = ctx
        self.call = call
        self.closing_timeout = closing_timeout
        self.timeouts = 0
        self.closing = False
        self.shutdown_task: asyncio.Task[None] | None = None

        @media.on("user_input_transcribed")
        def _transcript(event: Any) -> None:
            if not self.closing and getattr(event, "is_final", False) and str(getattr(event, "transcript", "")).strip():
                self.timeouts = 0

        @media.on("user_transcription_timeout")
        def _timeout(_event: Any) -> None:
            self.on_timeout()

    def on_timeout(self) -> None:
        if self.closing or self.call.closed:
            return
        self.timeouts += 1
        if self.call.recorder is not None:
            # A harmless error marker, never a guessed or partial transcript.
            self.call.recorder.add(
                [{"kind": "error", "speaker": "system", "data": {"outcome": "transcription_timeout"}}]
            )
        if self.timeouts == 1:
            try:
                self.media.say(REPEAT, allow_interruptions=True, add_to_chat_ctx=False)
                return
            except Exception:
                # Even the fallback voice could not be queued. End, don't loop.
                log.warning("unable to queue transcription recovery line")
        self._close()

    def _close(self) -> None:
        if self.closing:
            return
        self.closing = True
        self.call.closed, self.call.close_reason = True, REASON
        try:
            # Best effort and bounded: TTS must never keep a broken call alive.
            handle = self.media.say(ENDED, allow_interruptions=False, add_to_chat_ctx=False)
        except Exception:
            log.warning("unable to queue transcription closing line")
            self.ctx.shutdown(reason=REASON)
            return
        self.shutdown_task = asyncio.create_task(self._finish_and_shutdown(handle))

    async def _finish_and_shutdown(self, handle: Any) -> None:
        try:
            await asyncio.wait_for(handle, timeout=self.closing_timeout)
        except Exception:
            log.warning("transcription closing line did not complete")
        finally:
            self.ctx.shutdown(reason=REASON)
