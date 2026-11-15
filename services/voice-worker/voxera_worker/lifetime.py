"""Bound worker media lifetime even when callers never produce another transcript."""

from __future__ import annotations

import asyncio
import contextlib
import math


class CallLifetime:
    """Request job shutdown at the deadline or when the brain closes the call.

    The normal job shutdown callback persists the final call record. This guard
    never invokes a model or TTS provider. Carrier-side disconnect still needs
    acceptance testing with the approved SIP provider.
    """

    def __init__(self, ctx, call, *, poll_seconds: float = 0.25) -> None:
        if not math.isfinite(call.max_call_seconds) or call.max_call_seconds <= 0:
            raise ValueError("call lifetime must be finite and positive")
        if not math.isfinite(poll_seconds) or poll_seconds <= 0:
            raise ValueError("poll interval must be finite and positive")
        self.ctx = ctx
        self.call = call
        self.poll_seconds = poll_seconds
        self.task = asyncio.create_task(self._watch())

    async def _watch(self) -> None:
        while True:
            remaining = self.call.max_call_seconds - (self.call.clock() - self.call.started)
            if self.call.closed and self.call.close_reason == "speech transcription unavailable":
                return  # transcription recovery owns its bounded closing line and shutdown
            if self.call.closed or remaining <= 0:
                if not self.call.closed:
                    self.call.closed = True
                    self.call.close_reason = "time limit reached"
                self.ctx.shutdown(reason=self.call.close_reason or "call closed")
                return
            await asyncio.sleep(min(self.poll_seconds, remaining))

    async def stop(self) -> None:
        self.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.task
