"""Offline recovery tests for missing final STT transcripts (no audio/provider calls)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from voxera_worker.session import CallSession, ENDED
from voxera_worker.transcription_recovery import REASON, REPEAT, TranscriptionRecovery


class Recorder:
    def __init__(self):
        self.events = []
        self.ends = []

    def add(self, events):
        self.events.extend(events)

    async def end(self, *args):
        self.ends.append(args)


class FakeMedia:
    def __init__(self, *, fail_say_at=(), complete_closing=True):
        self.callbacks = {}
        self.lines = []
        self.fail_say_at = set(fail_say_at)
        self.complete_closing = complete_closing

    def on(self, name):
        def register(callback):
            self.callbacks[name] = callback
            return callback

        return register

    def fire(self, name, **kwargs):
        self.callbacks[name](SimpleNamespace(**kwargs))

    def say(self, text, *, allow_interruptions, add_to_chat_ctx):
        count = len(self.lines) + 1
        self.lines.append((text, allow_interruptions, add_to_chat_ctx))
        if count in self.fail_say_at:
            raise RuntimeError("fake speech failure")
        future = asyncio.get_running_loop().create_future()
        if self.complete_closing:
            future.set_result(None)
        return future


class FakeCtx:
    def __init__(self):
        self.reasons = []

    def shutdown(self, *, reason):
        self.reasons.append(reason)


def build(*, fail_say_at=(), complete_closing=True, closing_timeout=0.01):
    media = FakeMedia(fail_say_at=fail_say_at, complete_closing=complete_closing)
    ctx = FakeCtx()
    recorder = Recorder()
    call = CallSession(object(), recorder=recorder)
    guard = TranscriptionRecovery(media, ctx, call, closing_timeout=closing_timeout)
    return media, ctx, call, recorder, guard


async def test_one_timeout_asks_to_repeat_without_calling_brain_or_closing():
    media, ctx, call, recorder, guard = build()
    media.fire("user_transcription_timeout")
    assert media.lines == [(REPEAT, True, False)]
    assert not call.closed and not ctx.reasons
    assert guard.timeouts == 1
    assert recorder.events == [
        {"kind": "error", "speaker": "system", "data": {"outcome": "transcription_timeout"}}
    ]
    assert call.history == []


async def test_second_timeout_closes_call_with_bounded_closing_line_and_failed_record():
    media, ctx, call, recorder, guard = build()
    media.fire("user_transcription_timeout")
    media.fire("user_transcription_timeout")
    assert call.closed and call.close_reason == REASON and guard.closing
    assert media.lines == [(REPEAT, True, False), (ENDED, False, False)]
    assert guard.shutdown_task is not None
    await guard.shutdown_task
    assert ctx.reasons == [REASON]
    await call.finish()
    assert recorder.ends == [("failed", None, REASON)]
    assert len(recorder.events) == 2
    media.fire("user_transcription_timeout")
    assert len(media.lines) == 2 and len(recorder.events) == 2


async def test_only_final_nonempty_transcript_resets_failure_counter():
    media, ctx, call, _, guard = build()
    media.fire("user_transcription_timeout")
    media.fire("user_input_transcribed", is_final=False, transcript="partial")
    media.fire("user_input_transcribed", is_final=True, transcript="  ")
    assert guard.timeouts == 1
    media.fire("user_input_transcribed", is_final=True, transcript="hello")
    assert guard.timeouts == 0
    media.fire("user_transcription_timeout")
    assert guard.timeouts == 1 and not call.closed and not ctx.reasons


async def test_tts_failure_on_first_prompt_closes_without_looping():
    media, ctx, call, recorder, guard = build(fail_say_at=(1, 2))
    media.fire("user_transcription_timeout")
    assert guard.closing and call.closed and call.close_reason == REASON
    assert ctx.reasons == [REASON]
    assert guard.shutdown_task is None
    assert len(media.lines) == 2
    await call.finish()
    assert recorder.ends == [("failed", None, REASON)]


async def test_closing_tts_timeout_never_keeps_call_open():
    media, ctx, call, _, guard = build(complete_closing=False)
    media.fire("user_transcription_timeout")
    media.fire("user_transcription_timeout")
    assert guard.shutdown_task is not None
    await asyncio.wait_for(guard.shutdown_task, timeout=0.5)
    assert ctx.reasons == [REASON] and call.closed


async def test_preclosed_call_ignores_timeout_events():
    media, ctx, call, rec, guard = build()
    call.closed = True
    media.fire("user_transcription_timeout")
    assert not media.lines and not ctx.reasons and not rec.events and guard.timeouts == 0
