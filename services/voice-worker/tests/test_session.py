"""Call-session behaviour against a stand-in brain (simulated; no audio, no provider, no LiveKit server)."""

import asyncio
import json

import httpx
import pytest

from voxera_worker.brain import BrainClient
from voxera_worker.session import (
    CLOSING,
    FILLER,
    MESSAGE_DONE,
    MESSAGE_START,
    RECOVERY,
    CallSession,
    LanguageGate,
)


class Stream(httpx.AsyncByteStream):
    def __init__(self, events, delay=0.0, first_delay=0.0, closed=None):
        self.events, self.delay, self.first_delay, self.closed = events, delay, first_delay, closed

    async def __aiter__(self):
        try:
            await asyncio.sleep(self.first_delay)
            for e in self.events:
                yield f"data: {json.dumps(e)}\n\n".encode()
                await asyncio.sleep(self.delay)
        finally:
            if self.closed is not None:
                self.closed.append(True)


def ok(*parts, tools=(), handoff=None):
    evs = [{"type": "text", "text": p} for p in parts] + [{"type": "tool", "name": t, "ok": True} for t in tools]
    if handoff:
        evs.append({"type": "handoff", **handoff})
    return evs + [{"type": "done", "metrics": {"rounds": 1, "first_text_ms": 5}}]


class FakeBrain:
    """Scripted turns: each entry is (status, events, delay, first_delay)."""

    def __init__(self, script):
        self.script, self.requests, self.closed = list(script), [], []

    def client(self):
        async def handler(req: httpx.Request) -> httpx.Response:
            self.requests.append(json.loads(req.content))
            status, events, delay, first = self.script.pop(0)
            return httpx.Response(status, stream=Stream(events, delay, first, self.closed))

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return BrainClient("http://brain.test", "org-1", "token-not-logged", http)


async def say(session, text, **kw):
    return "".join([p async for p in session.reply(text, **kw)])


async def test_a_normal_turn_streams_the_brains_reply_and_keeps_history():
    fb = FakeBrain([(200, ok("We open ", "at nine."), 0, 0)])
    s = CallSession(fb.client())
    assert await say(s, "When do you open?") == "We open at nine."
    assert s.history == [
        {"role": "user", "text": "When do you open?"},
        {"role": "assistant", "text": "We open at nine."},
    ]
    sent = fb.requests[0]
    assert sent["messages"][-1] == {"role": "user", "text": "When do you open?"}
    assert sent["conversation_id"] == s.conversation_id and sent["language"] == "en-GB"
    assert s.turns[0].outcome == "done" and s.turns[0].server_metrics["rounds"] == 1


async def test_slow_first_text_gets_one_filler_line_then_the_reply():
    fb = FakeBrain([(200, ok("Yes, Friday at ten."), 0, 0.3)])
    s = CallSession(fb.client(), filler_after=0.05)
    out = [p async for p in s.reply("Anything Friday?")]
    assert out == [FILLER, "Yes, Friday at ten."]
    assert s.turns[0].outcome == "filler_then_done"
    assert s.history[-1]["text"] == "Yes, Friday at ten."  # the filler is not sent back to the brain


async def test_a_turn_past_the_deadline_is_abandoned_with_the_recovery_line():
    fb = FakeBrain([(200, ok("too late"), 0, 1.0)])
    s = CallSession(fb.client(), filler_after=0.05, turn_deadline=0.2)
    out = [p async for p in s.reply("Hello?")]
    assert out == [FILLER, RECOVERY] and s.turns[0].outcome == "timeout"
    assert s.history == []  # the unanswered caller turn is not left dangling
    assert s.turns[0].worker_line == FILLER + RECOVERY and s.turns[0].reply == ""
    await asyncio.sleep(0.05)
    assert fb.closed  # the brain request was closed


async def test_two_failures_switch_to_deterministic_message_taking():
    fb = FakeBrain([(500, [], 0, 0), (200, [{"type": "error", "message": "x"}], 0, 0)])
    s = CallSession(fb.client())
    assert await say(s, "Hi") == RECOVERY
    assert await say(s, "Hello?") == MESSAGE_START and s.message_mode
    assert await say(s, "Sam Patel") != MESSAGE_DONE
    await say(s, "07700 900123")
    assert await say(s, "About my booking") == MESSAGE_DONE
    assert s.message == ["Sam Patel", "07700 900123", "About my booking"]
    assert len(fb.requests) == 2  # the brain is not called again in message mode


async def test_a_success_resets_the_failure_count():
    fb = FakeBrain([(500, [], 0, 0), (200, ok("Hi!"), 0, 0), (500, [], 0, 0)])
    s = CallSession(fb.client())
    await say(s, "a")
    await say(s, "b")
    assert await say(s, "c") == RECOVERY and not s.message_mode


async def test_interrupting_a_recovery_line_leaves_history_clean():
    fb = FakeBrain([(500, [], 0, 0)])
    s = CallSession(fb.client())
    gen = s.reply("Hi")
    assert await gen.__anext__() == RECOVERY
    await gen.aclose()  # caller talks over the recovery line
    assert s.history == [] and s.turns[0].outcome == "interrupted"


async def test_a_stream_that_ends_without_done_is_a_failure():
    fb = FakeBrain([(200, [{"type": "text", "text": "half"}], 0, 0)])
    s = CallSession(fb.client())
    out = await say(s, "Hi")
    assert out.endswith(RECOVERY) and s.turns[0].outcome == "failed"


async def test_barge_in_cancels_the_turn_and_closes_the_brain_request():
    fb = FakeBrain([(200, ok("one ", "two ", "three ", "four"), 0.1, 0), (200, ok("Sure."), 0, 0)])
    s = CallSession(fb.client())
    heard = []

    async def speak():
        async for piece in s.reply("Tell me everything"):
            heard.append(piece)

    task = asyncio.create_task(speak())
    await asyncio.sleep(0.15)
    task.cancel()  # the caller started talking
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.05)
    assert fb.closed and s.turns[0].outcome == "interrupted"
    assert 1 <= len(heard) < 4
    assert s.history[-1]["text"].endswith("…")  # the brain sees the reply was cut off
    assert await say(s, "Actually, just Friday") == "Sure."


async def test_hand_off_is_reported_once():
    seen = []
    fb = FakeBrain([(200, ok("Putting you through.", handoff={"outcome": "transfer", "staff": "Ana"}), 0, 0)])
    s = CallSession(fb.client(), on_handoff=seen.append)
    await say(s, "Can I speak to someone?")
    assert seen == [{"outcome": "transfer", "staff": "Ana", "case": None}] and s.summary()["handoffs"] == 1


async def test_tool_calls_and_confirmation_stay_in_the_brain():
    fb = FakeBrain([(200, ok("Shall I book 10am?", tools=["check_availability"]), 0, 0)])
    s = CallSession(fb.client())
    await say(s, "Book me in Friday")
    assert s.turns[0].tools == [{"name": "check_availability", "ok": True}]
    assert "book_appointment" not in json.dumps(fb.requests)  # the worker never calls tools itself


async def test_call_time_limit_closes_politely_without_calling_the_brain():
    now = [0.0]
    fb = FakeBrain([])
    s = CallSession(fb.client(), max_call_seconds=60, clock=lambda: now[0])
    now[0] = 61
    assert await say(s, "Still there?") == CLOSING and s.closed and fb.requests == []


async def test_language_switches_after_confirmation_and_is_sent_to_the_brain():
    fb = FakeBrain([(200, ok("x"), 0, 0)] * 3)
    s = CallSession(fb.client(), language=LanguageGate(accepted=("en-GB", "hi-IN")))
    await say(s, "namaste", detected_language="hi", confidence=0.9)
    await say(s, "mujhe appointment chahiye", detected_language="hi", confidence=0.9)
    await say(s, "kal", detected_language="hi", confidence=0.9)
    assert [r["language"] for r in fb.requests] == ["en-GB", "hi-IN", "hi-IN"]
    assert len([m for m in fb.requests[-1]["messages"] if m["role"] == "user"]) == 3  # context preserved


def test_language_gate_manual_choice_wins():
    g = LanguageGate(accepted=("en-GB", "ar-SA"))
    assert g.choose("ar-SA") and not g.observe("en", 0.99) and g.current == "ar-SA"
    assert not g.choose("fr-FR")


def test_worker_mode_uses_the_scoped_endpoint_and_never_the_org_in_the_url():
    c = BrainClient("http://api.test/", "org-should-not-appear", "t", worker=True)
    assert c.url == "http://api.test/v1/worker/live/brain"
    assert BrainClient("http://api.test", "org-1", "t").url == "http://api.test/v1/orgs/org-1/live/brain"
