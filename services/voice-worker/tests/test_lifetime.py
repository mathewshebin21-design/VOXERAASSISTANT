"""No providers or wall-clock waits: silent calls and closed sessions must terminate."""

import asyncio
from types import SimpleNamespace

import pytest

from voxera_worker.lifetime import CallLifetime


def build(*, elapsed=0, closed=False, reason=None, limit=900):
    reasons = []
    call = SimpleNamespace(
        started=0,
        clock=lambda: elapsed,
        max_call_seconds=limit,
        closed=closed,
        close_reason=reason,
    )
    ctx = SimpleNamespace(shutdown=lambda **kw: reasons.append(kw["reason"]))
    return ctx, call, reasons


async def test_silent_call_at_deadline_requests_shutdown_without_another_turn():
    ctx, call, reasons = build(elapsed=900)
    guard = CallLifetime(ctx, call)
    await guard.task
    assert call.closed and reasons == ["time limit reached"]
    await guard.stop()
    assert reasons == ["time limit reached"]


async def test_closed_credential_mismatch_is_not_left_running():
    ctx, call, reasons = build(closed=True, reason="credential mismatch")
    guard = CallLifetime(ctx, call)
    await guard.task
    assert reasons == ["credential mismatch"]


async def test_normal_disconnect_cancels_guard_without_an_extra_shutdown():
    ctx, call, reasons = build()
    guard = CallLifetime(ctx, call)
    await asyncio.sleep(0)
    await guard.stop()
    assert not call.closed and reasons == [] and guard.task.done()


async def test_timer_observes_closure_while_waiting(monkeypatch):
    ctx, call, reasons = build()

    async def close_on_sleep(seconds):
        assert 0 < seconds <= 0.25
        call.closed, call.close_reason = True, "credential mismatch"

    monkeypatch.setattr("voxera_worker.lifetime.asyncio.sleep", close_on_sleep)
    guard = CallLifetime(ctx, call)
    await guard.task
    assert reasons == ["credential mismatch"]


@pytest.mark.parametrize("limit", [0, -1, float("inf"), float("nan")])
async def test_invalid_lifetime_is_rejected_without_starting_a_task(limit):
    ctx, call, reasons = build(limit=limit)
    with pytest.raises(ValueError, match="finite and positive"):
        CallLifetime(ctx, call)
    assert reasons == []
