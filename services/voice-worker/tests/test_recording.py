"""The worker writes its calls into call records: spoken order, worker lines, outcomes, and never
breaking the call when recording fails. Simulated (stand-in brain and stand-in call-record API)."""

import asyncio
import json

import httpx
from test_session import FakeBrain, ok, say

from voxera_worker.recording import CallRecorder
from voxera_worker.session import FILLER, MESSAGE_START, RECOVERY, CallSession, call_outcome, turn_events


class FakeRecords:
    """Stand-in for /v1/worker/calls: stores what the worker writes."""

    def __init__(self, fail_events=False, slow_first=0.0, expire_once=False):
        self.calls, self.events, self.ended, self.tokens = [], [], [], []
        self.fail_events, self.slow_first, self.expire_once = fail_events, slow_first, expire_once
        self.writes = 0

    def recorder(self, tokens=None):
        async def handler(req: httpx.Request) -> httpx.Response:
            self.tokens.append(req.headers["authorization"])
            if self.expire_once:
                self.expire_once = False
                return httpx.Response(401, json={"detail": "expired"})
            body = json.loads(req.content)
            path = req.url.path
            if path == "/v1/worker/calls":
                self.calls.append(body)
                return httpx.Response(201, json={"id": "call-1"})
            if path.endswith("/events"):
                self.writes += 1
                if self.writes == 1 and self.slow_first:
                    await asyncio.sleep(self.slow_first)
                if self.fail_events:
                    return httpx.Response(500, json={})
                self.events += body["events"]
                return httpx.Response(201, json=[])
            if path.endswith("/end"):
                self.ended.append(body)
                return httpx.Response(200, json={})
            return httpx.Response(404)

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return CallRecorder("http://api.test", tokens or Tokens(), http)


class Tokens:
    def __init__(self):
        self.n = 0

    async def get(self):
        return f"t{self.n}"

    async def refresh(self, stale=None):
        self.n += 1
        return f"t{self.n}"


async def test_a_call_is_recorded_turn_by_turn_in_spoken_order():
    fb = FakeBrain(
        [
            (200, ok("We're open until six."), 0, 0),
            (200, ok("Booked for Friday at ten.", tools=["check_availability", "book_appointment"]), 0, 0.2),
        ]
    )
    fr = FakeRecords()
    s = CallSession(fb.client(), recorder=fr.recorder(), filler_after=0.05)
    assert await s.begin(external_ref="room-abc12345", ai_disclosure_played=True, recording_notice_played=True)
    await say(s, "Are you open today?")
    await say(s, "Can I book Friday at ten?")
    await s.finish()

    assert fr.calls == [
        {"ai_disclosure_played": True, "recording_notice_played": True, "external_ref": "room-abc12345"}
    ]
    kinds = [(e["kind"], e.get("speaker"), e.get("text")) for e in fr.events]
    assert kinds == [
        ("utterance", "caller", "Are you open today?"),
        ("utterance", "agent", "We're open until six."),
        ("utterance", "caller", "Can I book Friday at ten?"),
        ("utterance", "agent", FILLER),  # the holding line, heard before the reply
        ("tool", "agent", None),
        ("tool", "agent", None),
        ("utterance", "agent", "Booked for Friday at ten."),
    ]
    assert fr.events[3]["data"] == {"by": "worker", "outcome": "filler_then_done"}
    assert fr.events[4]["data"] == {"name": "check_availability", "ok": True}
    assert "metrics" in fr.events[6]["data"]
    assert fr.ended == [{"status": "completed", "outcome": "booked", "reason": "caller hung up"}]
    # One writer: the brain is never asked to record the call itself.
    assert all("call_id" not in r for r in fb.requests)


async def test_failures_and_message_taking_are_recorded_and_the_call_ends_as_a_message():
    fb = FakeBrain([(500, [], 0, 0), (200, [{"type": "error", "message": "x"}], 0, 0)])
    fr = FakeRecords()
    s = CallSession(fb.client(), recorder=fr.recorder())
    await s.begin()
    await say(s, "Hi")
    await say(s, "Hello?")
    await say(s, "Sam Patel")
    await s.finish()
    texts = [(e["kind"], e.get("text")) for e in fr.events]
    assert texts == [
        ("utterance", "Hi"),
        ("error", None),
        ("utterance", RECOVERY),
        ("utterance", "Hello?"),
        ("error", None),
        ("utterance", MESSAGE_START),
        ("utterance", "Sam Patel"),
        ("utterance", "And the best number to reach you on?"),
    ]
    assert fr.ended[0]["status"] == "completed" and fr.ended[0]["outcome"] == "message_taken"


async def test_writes_stay_in_order_when_the_api_is_slow_and_never_hold_up_the_caller():
    fb = FakeBrain([(200, ok("One."), 0, 0), (200, ok("Two."), 0, 0)])
    fr = FakeRecords(slow_first=0.3)
    s = CallSession(fb.client(), recorder=fr.recorder())
    await s.begin()
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    await say(s, "first")
    await say(s, "second")
    assert loop.time() - t0 < 0.25  # the caller heard both replies before the first write finished
    await s.finish()
    assert [e.get("text") for e in fr.events] == ["first", "One.", "second", "Two."]


async def test_a_recording_failure_never_breaks_the_call_and_the_record_is_still_closed():
    fb = FakeBrain([(200, ok("Hello."), 0, 0), (200, ok("Still here."), 0, 0)])
    fr = FakeRecords(fail_events=True)
    s = CallSession(fb.client(), recorder=fr.recorder())
    await s.begin()
    assert await say(s, "Hi") == "Hello."
    assert await say(s, "Are you there?") == "Still here."
    await s.finish()
    assert s.recorder.failed and fr.writes == 1  # stopped after the first refused write, no gaps written
    assert fr.ended and fr.ended[0]["outcome"] == "answered"


async def test_the_recorder_refreshes_an_expired_token_once():
    fr = FakeRecords(expire_once=True)
    rec = fr.recorder()
    assert await rec.start() == "call-1"
    assert fr.tokens == ["Bearer t0", "Bearer t1"]


async def test_without_a_record_nothing_is_written_and_the_call_works():
    fb = FakeBrain([(200, ok("Hi."), 0, 0)])
    s = CallSession(fb.client())
    assert await s.begin() is None
    assert await say(s, "Hello") == "Hi."
    await s.finish()


def _session_with(turns, message=None, failures=0):
    s = CallSession(FakeBrain([]).client())
    s.turns, s.failures = turns, failures
    if message is not None:
        s.message_mode, s.message = True, message
    return s


def test_the_outcome_comes_from_what_actually_happened():
    from voxera_worker.session import TurnRecord

    booked = TurnRecord(caller="x", reply="Done", tools=[{"name": "book_appointment", "ok": True}])
    failed_booking = TurnRecord(caller="x", reply="Sorry", tools=[{"name": "book_appointment", "ok": False}])
    queued = TurnRecord(caller="x", reply="Someone will call", handoff={"outcome": "queued"})
    transferred = TurnRecord(caller="x", reply="Putting you through", handoff={"outcome": "transferred"})
    nothing = TurnRecord(caller="x", outcome="failed", worker_line=RECOVERY)
    assert call_outcome(_session_with([booked])) == ("completed", "booked")
    assert call_outcome(_session_with([failed_booking])) == ("completed", "answered")
    assert call_outcome(_session_with([queued])) == ("completed", "message_taken")
    assert call_outcome(_session_with([booked, transferred])) == ("completed", "transferred")
    assert call_outcome(_session_with([nothing], failures=1)) == ("failed", None)
    assert call_outcome(_session_with([nothing], message=[])) == ("completed", "no_action")
    assert call_outcome(_session_with([])) == ("completed", "no_action")


def test_turn_events_never_include_tool_results_and_mark_interruptions():
    from voxera_worker.session import TurnRecord

    rec = TurnRecord(
        caller="Hi", reply="Hello, how", outcome="interrupted", tools=[{"name": "list_services", "ok": True}]
    )
    evs = turn_events(rec)
    assert evs[1] == {"kind": "tool", "speaker": "agent", "data": {"name": "list_services", "ok": True}}
    assert evs[2]["data"]["interrupted"] is True
    assert "result" not in json.dumps(evs)


def test_room_reference_is_stable_and_never_contains_the_callers_number():
    from voxera_worker.recording import room_ref

    ref = room_ref("_+447700900123_sip_abcd")
    assert ref == room_ref("_+447700900123_sip_abcd") and ref.startswith("room-")
    assert "447700900123" not in ref and 8 <= len(ref) <= 64
    assert room_ref(None) is None and room_ref("") is None
