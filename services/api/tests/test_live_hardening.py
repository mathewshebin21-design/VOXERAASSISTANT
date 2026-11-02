# ruff: noqa: F811  (pytest fixtures imported from other test modules are used as arguments)
"""Hardening of the live AI path: malformed and interrupted provider streams, validation of
model-generated tool calls, per-tool tenant isolation, and concurrency-safe usage caps."""

import json
import threading
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, set_tenant
from app.live import budget, providers, receptionist, toolcheck
from app.models import UsageKind
from app.routers import live as live_router

from .conftest import join
from .test_live import brain_body, events, live, message, setup_business  # noqa: F401  (live is a fixture)
from .test_live_openai import chunks, oa, tool_call  # noqa: F401  (oa is a fixture)
from .test_live_openai import text as text_chunks


def raw(*lines: str) -> bytes:
    return "".join(f"{x}\n\n" for x in lines).encode()


def data(obj: object) -> str:
    return f"data: {json.dumps(obj)}"


def reservations(owner_engine) -> int:
    with owner_engine.connect() as c:
        return c.execute(text("SELECT count(*) FROM live_reservations")).scalar()


def recorded(owner_engine) -> list[tuple[str, int]]:
    with owner_engine.connect() as c:
        rows = c.execute(text("SELECT idempotency_key, quantity FROM usage_events WHERE source = 'live'")).all()
    return [(r[0], int(r[1])) for r in rows]


def cases(owner_engine) -> int:
    with owner_engine.connect() as c:
        return c.execute(text("SELECT count(*) FROM caller_messages")).scalar()


MESSAGE_ARGS = json.dumps({"caller_name": "Jo", "caller_phone": "07700900123", "message": "Call me", "urgent": False})


# ---------- OpenAI-compatible stream: malformed, incomplete and interrupted replies ----------


@pytest.mark.parametrize(
    ("body", "expect"),
    [
        (raw("data: {not json"), "malformed reply"),
        (raw("data: [1, 2, 3]"), "malformed reply"),
        (raw(data({"choices": "nope"})), "malformed reply"),
        (raw(data({"choices": [{"delta": {"content": 42}}]})), "malformed reply"),
        (raw(data({"choices": [{"delta": {"tool_calls": [{"index": "x"}]}}]})), "malformed tool call"),
        (raw(data({"choices": [{"delta": {"tool_calls": [{"index": 99, "function": {}}]}}]})), "malformed tool call"),
        (raw(data({"choices": [{"delta": {"content": "Hel"}}]}), data({"error": {"message": "overloaded"}})), "error"),
        (raw("data: NaN"), "malformed reply"),
    ],
)
def test_malformed_chunks_end_the_turn_safely(make_account, oa, owner_engine, body, expect):
    a = make_account("ada@example.com")
    oa["replies"] = [(200, body)]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert ev[-1]["type"] == "error" and expect in ev[-1]["message"]
    assert reservations(owner_engine) == 0  # settled, not left holding the budget
    assert all(q > 0 for _, q in recorded(owner_engine))  # what was sent is still counted


def test_truncated_stream_never_runs_a_half_received_tool_call(make_account, oa, owner_engine):
    a = make_account("ada@example.com")
    first = {"index": 0, "id": "c1", "type": "function", "function": {"name": "take_message", "arguments": ""}}
    # The connection drops after the arguments arrive but before any finish_reason or [DONE].
    oa["replies"] = [
        (
            200,
            raw(
                data({"choices": [{"index": 0, "delta": {"tool_calls": [first]}}]}),
                data(
                    {
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"tool_calls": [{"index": 0, "function": {"arguments": MESSAGE_ARGS}}]},
                            }
                        ]
                    }
                ),
            ),
        )
    ]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert ev == [{"type": "error", "message": "The language model stopped before finishing its reply."}]
    assert cases(owner_engine) == 0


def test_cut_off_replies_are_reported_not_accepted(make_account, oa, owner_engine):
    a = make_account("ada@example.com")
    cut_call = tool_call("take_message", MESSAGE_ARGS)
    cut_call[-1]["choices"][0]["finish_reason"] = "length"
    oa["replies"] = [(200, chunks(*cut_call))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert ev[-1] == {"type": "error", "message": "Reply was cut off before a tool call finished."}
    assert cases(owner_engine) == 0

    cut_text = text_chunks("We open at nine and")
    cut_text[-1]["choices"][0]["finish_reason"] = "length"
    oa["replies"] = [(200, chunks(*cut_text))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert ev[-1] == {"type": "error", "message": "The reply was cut off before it finished."}

    filtered = text_chunks("…")
    filtered[-1]["choices"][0]["finish_reason"] = "content_filter"
    oa["replies"] = [(200, chunks(*filtered))]
    assert "safety filter" in events(a.post(a.o("/live/brain"), json=brain_body()))[-1]["message"]


def test_provider_timeouts_and_disconnects(make_account, oa, monkeypatch, owner_engine):
    a = make_account("ada@example.com")

    def timeout(req):
        raise httpx.ReadTimeout("slow", request=req)

    monkeypatch.setattr(providers, "openai_http", lambda: httpx.Client(transport=httpx.MockTransport(timeout)))
    assert events(a.post(a.o("/live/brain"), json=brain_body())) == [
        {"type": "error", "message": "The language model timed out."}
    ]

    def refused(req):
        raise httpx.ConnectError("refused", request=req)

    monkeypatch.setattr(providers, "openai_http", lambda: httpx.Client(transport=httpx.MockTransport(refused)))
    assert events(a.post(a.o("/live/brain"), json=brain_body())) == [
        {"type": "error", "message": "Could not reach the language model."}
    ]
    assert reservations(owner_engine) == 0


def test_whole_turn_deadline(make_account, oa, monkeypatch):
    a = make_account("ada@example.com")
    monkeypatch.setattr(live_router, "TURN_DEADLINE_S", -1.0)
    oa["replies"] = [(200, chunks(*text_chunks("Hello")))]
    assert events(a.post(a.o("/live/brain"), json=brain_body()))[-1] == {
        "type": "error",
        "message": "The language model took too long to answer.",
    }


def test_endless_tool_loop_stops_with_an_error(make_account, oa):
    a = make_account("ada@example.com")
    setup_business(a)
    oa["replies"] = [(200, chunks(*tool_call("list_services"))) for _ in range(live_router.MAX_ROUNDS)]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool"] * live_router.MAX_ROUNDS + ["error"]
    assert "couldn't finish" in ev[-1]["message"]


# ---------- tool-call validation (both providers) ----------


@pytest.mark.parametrize(
    ("name", "args", "why"),
    [
        ("drop_tables", "{}", "unknown tool"),
        ("take_message", "[1]", "must be a JSON object"),
        ("take_message", json.dumps({"caller_name": "Jo"}), "is required"),
        ("take_message", MESSAGE_ARGS[:-1] + ', "admin": true}', "unknown field"),
        ("take_message", MESSAGE_ARGS.replace("false", '"yes"'), "must be boolean"),
        ("take_message", MESSAGE_ARGS.replace("false", "Infinity"), "not valid JSON"),
        ("check_availability", json.dumps({"service_name": "x", "date": None, "part_of_day": "midnight"}), "one of"),
        ("take_message", MESSAGE_ARGS.replace('"Call me"', json.dumps("x" * 5000)), "too long"),
    ],
)
def test_invalid_tool_calls_are_rejected_before_running(make_account, oa, owner_engine, name, args, why):
    a = make_account("ada@example.com")
    oa["replies"] = [(200, chunks(*tool_call(name, args))), (200, chunks(*text_chunks("Let me try that again.")))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool", "text", "done"]
    assert ev[0]["ok"] is False and why in ev[0]["result"]
    assert ev[0]["name"] in {name, "invalid_tool_call"} and ev[0]["name"] != "drop_tables"
    assert cases(owner_engine) == 0  # nothing ran


def test_a_crashing_tool_is_contained(make_account, oa, monkeypatch, owner_engine):
    a = make_account("ada@example.com")

    def boom(*_a, **_k):
        raise RuntimeError("database fell over")

    monkeypatch.setattr(live_router, "run_tool", boom)
    oa["replies"] = [(200, chunks(*tool_call("take_message", MESSAGE_ARGS))), (200, chunks(*text_chunks("Sorry.")))]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool", "text", "done"]
    assert ev[0] == {"type": "tool", "name": "take_message", "ok": False, "result": "internal error"}
    assert "database fell over" not in json.dumps(ev)  # internals never leak to the caller or model


def test_anthropic_path_validates_and_reports_truncation(make_account, live, owner_engine):
    a = make_account("ada@example.com")
    live["llm"] = [
        (200, message([("tool", {"id": "toolu_1", "name": "drop_tables"})], "tool_use", 50, 5)),
        (200, message([("text", {"parts": ["Sorry about that."]})], "end_turn", 60, 5)),
    ]
    ev = events(a.post(a.o("/live/brain"), json=brain_body()))
    assert [e["type"] for e in ev] == ["tool", "text", "done"]
    assert ev[0]["name"] == "invalid_tool_call" and "unknown tool" in ev[0]["result"]
    sent = json.loads(live["llm_requests"][1].content)["messages"][-1]["content"][0]
    assert sent["is_error"] is True

    live["llm"] = [(200, message([("text", {"parts": ["We open at"]})], "max_tokens", 50, 400))]
    assert events(a.post(a.o("/live/brain"), json=brain_body()))[-1] == {
        "type": "error",
        "message": "The reply was cut off before it finished.",
    }
    assert reservations(owner_engine) == 0


# ---------- cancellation, retries and concurrency ----------


def test_cancelled_stream_settles_its_reservation(make_account, oa, owner_engine):
    a = make_account("ada@example.com")
    org, user = uuid.UUID(a.org_id), uuid.UUID(a.user_id)
    db = SessionLocal()
    set_tenant(db, org_id=org, user_id=user)
    budget.reserve(db, org, UsageKind.llm_tokens, 50_000, "llm-cancel-test")
    db.close()
    assert reservations(owner_engine) == 1
    oa["replies"] = [(200, chunks(*text_chunks("Hello ", "there, ", "how can I help?")))]
    gen = live_router._openai_stream(
        system="sys",
        tools=receptionist.TOOLS,
        msgs=[{"role": "user", "content": "hi"}],
        run=lambda *_: (True, "{}", ""),
        org_id=org,
        user_id=user,
        usage_key="llm-cancel-test",
        reference="test",
        reserved=50_000,
    )
    assert json.loads(next(gen)[6:])["type"] == "text"
    gen.close()  # the caller hung up mid-reply
    assert reservations(owner_engine) == 0
    [(key, qty)] = recorded(owner_engine)
    assert key == "llm-cancel-test" and qty > 0  # the prompt that was sent still counts


def test_a_request_id_can_only_be_used_once(make_account, oa):
    a = make_account("ada@example.com")
    body = brain_body()
    oa["replies"] = [(200, chunks(*text_chunks("Hi")))]
    assert events(a.post(a.o("/live/brain"), json=body))[-1]["type"] == "done"
    r = a.post(a.o("/live/brain"), json=body)  # a retry of the same turn would be billed twice
    assert r.status_code == 409 and len(oa["requests"]) == 1


def test_simultaneous_reservations_cannot_exceed_the_cap(make_account, monkeypatch, owner_engine):
    a = make_account("ada@example.com")
    org, user = uuid.UUID(a.org_id), uuid.UUID(a.user_id)
    monkeypatch.setattr(get_settings(), "live_llm_tokens_per_org_month", 10_000)
    monkeypatch.setattr(get_settings(), "live_llm_tokens_global_month", 1_000_000)
    n, each = 12, 3_000  # room for 3
    gate = threading.Barrier(n)
    outcome: list[int] = []
    winners: list[int] = []

    def attempt(i: int) -> None:
        db = SessionLocal()
        set_tenant(db, org_id=org, user_id=user)
        try:
            gate.wait()
            budget.reserve(db, org, UsageKind.llm_tokens, each, f"llm-race-{i}")
            outcome.append(200)
            winners.append(i)
        except HTTPException as e:
            outcome.append(e.status_code)
        finally:
            db.close()

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcome) == [200] * 3 + [429] * 9
    assert reservations(owner_engine) == 3

    # Settling swaps a reservation for actual usage and frees the difference.
    budget.settle(org, user, UsageKind.llm_tokens, f"llm-race-{winners[0]}", 1_000, "test")
    db = SessionLocal()
    set_tenant(db, org_id=org, user_id=user)
    b = budget.budget(db, org, UsageKind.llm_tokens)
    db.close()
    assert (b.org_used, b.org_reserved, b.remaining) == (1_000, 6_000, 3_000)


def test_global_cap_counts_other_workspaces_reservations(make_account, monkeypatch):
    a, b = make_account("ada@example.com"), make_account("bo@example.com", "Other")
    monkeypatch.setattr(get_settings(), "live_llm_tokens_per_org_month", 10_000)
    monkeypatch.setattr(get_settings(), "live_llm_tokens_global_month", 12_000)
    for acct, need, key in ((a, 8_000, "llm-g-a"), (b, 8_000, "llm-g-b")):
        org = uuid.UUID(acct.org_id)
        db = SessionLocal()
        set_tenant(db, org_id=org, user_id=uuid.UUID(acct.user_id))
        try:
            budget.reserve(db, org, UsageKind.llm_tokens, need, key)
            result = 200
        except HTTPException as e:
            result = e.status_code
        finally:
            db.close()
        assert result == (200 if acct is a else 429)


def test_tts_charge_is_atomic_and_single_use(make_account, live):
    a = make_account("ada@example.com")
    live["tts"] = [(200, b"ID3audio")]
    body = {"request_id": "tts-once-0001", "text": "Hello"}
    assert a.post(a.o("/live/tts"), json=body).status_code == 200
    assert a.post(a.o("/live/tts"), json=body).status_code == 409
    assert len(live["tts_requests"]) == 1


def test_status_says_caps_are_units_not_money(make_account, live):
    a = make_account("ada@example.com")
    st = a.get(a.o("/live/status")).json()
    assert st["llm"]["unit"] == "llm_tokens" and "not a monetary" in st["llm"]["limit_note"]


# ---------- authorisation and tenant isolation, tool by tool ----------


@pytest.fixture
def two_shops(make_account):
    """Workspace A with a service, open hours and a booking; workspace B with its own service."""
    a, b = make_account("ada@example.com", "Alpha"), make_account("bo@example.com", "Bravo")
    week = {"intervals": [{"weekday": d, "opens_at": "00:00", "closes_at": "23:59"} for d in range(7)]}
    for acct, svc in ((a, "Alpha cut"), (b, "Bravo shave")):
        assert acct.put(acct.o("/office-hours"), json=week).status_code == 200
        acct.service = acct.post(acct.o("/services"), json={"name": svc, "duration_min": 30}).json()
    day = (datetime.now(UTC) + timedelta(days=2)).date().isoformat()
    slot = a.get(a.o(f"/availability?service_id={a.service['id']}&on={day}")).json()["slots"][0]
    a.appt = a.post(
        a.o("/appointments"),
        json={
            "service_id": a.service["id"],
            "starts_at": slot,
            "customer_name": "Ann",
            "customer_phone": "07700900111",
        },
    ).json()
    return a, b


def run_as(acct, name: str, args: dict, said: str = "yes please") -> tuple[bool, dict]:
    org = uuid.UUID(acct.org_id)
    db = SessionLocal()
    set_tenant(db, org_id=org, user_id=uuid.UUID(acct.user_id))
    try:
        ctx = receptionist.load_context(db, org)
        args = toolcheck.validate_call({t["name"]: t for t in receptionist.TOOLS}, name, args)
        ok, out = receptionist.run_tool(db, ctx, receptionist.Turn(org, "conv-1", said), name, args)
        return ok, json.loads(out)
    finally:
        db.close()


def test_every_receptionist_tool_is_confined_to_its_workspace(two_shops, owner_engine):
    a, b = two_shops
    ref, phone = a.appt["id"][:8], "07700900111"
    for name in ("get_business_info", "get_opening_hours", "list_services"):
        ok, out = run_as(b, name, {})
        assert ok and "Alpha" not in json.dumps(out)
    assert not run_as(b, "check_availability", {"service_name": "Alpha cut", "date": None, "part_of_day": "any"})[0]
    book = {"service_name": "Alpha cut", "start": "2030-01-01T10:00", "customer_name": "X", "customer_phone": phone}
    assert not run_as(b, "book_appointment", {**book, "notes": None})[0]
    ok, out = run_as(b, "find_my_appointments", {"customer_phone": phone})
    assert ok and out == {"appointments": []}
    assert not run_as(b, "cancel_appointment", {"appointment_ref": ref, "customer_phone": phone})[0]
    move = {"appointment_ref": ref, "customer_phone": phone, "new_start": "2030-01-02T10:00"}
    assert not run_as(b, "reschedule_appointment", move)[0]
    msg = {"caller_name": "Jo", "caller_phone": phone, "message": "hi", "urgent": False}
    assert run_as(b, "take_message", msg)[0]
    hand = {"reason": "asked", "summary": "wants a person", "caller_name": None, "caller_phone": None, "urgent": False}
    assert run_as(b, "transfer_to_staff", hand)[0]

    # A's booking is untouched and B's messages landed only in B.
    assert a.get(a.o("/appointments")).json()[0]["status"] == "booked"
    assert a.get(a.o("/cases?status=new")).json() == []
    assert len(b.get(b.o("/cases?status=new")).json()) == 2


def test_callers_can_only_touch_their_own_booking_and_one_change_per_yes(two_shops):
    a, _ = two_shops
    ref = a.appt["id"][:8]
    # Right workspace, wrong phone: refused without revealing anything.
    ok, out = run_as(a, "cancel_appointment", {"appointment_ref": ref, "customer_phone": "07700900999"})
    assert not ok and "can't find" in out["error"]
    # No clear yes: refused.
    ok, out = run_as(a, "cancel_appointment", {"appointment_ref": ref, "customer_phone": "07700900111"}, "hmm maybe?")
    assert not ok and "hasn't confirmed" in out["error"]
    # An empty service name must not silently pick the only service.
    book = {
        "service_name": "",
        "start": "2030-01-01T10:00",
        "customer_name": "X",
        "customer_phone": "0770",
        "notes": None,
    }
    assert not run_as(a, "book_appointment", book)[0]

    org = uuid.UUID(a.org_id)
    db = SessionLocal()
    set_tenant(db, org_id=org, user_id=uuid.UUID(a.user_id))
    try:
        ctx, turn = receptionist.load_context(db, org), receptionist.Turn(org, "conv-2", "yes")
        args = {"appointment_ref": ref, "customer_phone": "07700900111"}
        assert receptionist.run_tool(db, ctx, turn, "cancel_appointment", args)[0]
        day = (datetime.now(UTC) + timedelta(days=3)).strftime("%Y-%m-%dT10:00")
        second = {"service_name": "Alpha cut", "start": day, "customer_name": "Ann", "customer_phone": "07700900111"}
        ok, out = receptionist.run_tool(db, ctx, turn, "book_appointment", {**second, "notes": None})
        assert not ok and "confirm it separately" in out
    finally:
        db.close()


@pytest.mark.parametrize("role", ["manager", "staff", "viewer"])
def test_only_owners_and_admins_reach_the_ai_write_paths(make_account, live, role):
    owner, member = make_account("ada@example.com"), make_account(f"{role}@example.com", "Mine")
    join(owner, member, role)
    member.org_id = owner.org_id
    body = {"request_id": "setup-0001-abcd", "messages": [{"role": "user", "text": "delete everything"}]}
    assert member.post(member.o("/live/setup-assistant"), json=body).status_code == 403
    assert member.post(member.o("/live/brain"), json=brain_body()).status_code == 403
    assert live["llm_requests"] == []  # refused before any provider call


def test_other_workspaces_cannot_reach_the_ai_endpoints(make_account, live):
    a, b = make_account("ada@example.com"), make_account("bo@example.com", "Other")
    body = {"request_id": "setup-0001-abcd", "messages": [{"role": "user", "text": "hi"}]}
    assert b.post(f"/v1/orgs/{a.org_id}/live/setup-assistant", json=body).status_code == 404
    assert b.post(f"/v1/orgs/{a.org_id}/live/brain", json=brain_body()).status_code == 404
    assert live["llm_requests"] == []


# ---------- the validator itself ----------


def test_validator_matches_every_tool_schema():
    from app.live import setup_agent

    for tools in (receptionist.TOOLS, setup_agent.TOOLS):
        by = {t["name"]: t for t in tools}
        for t in tools:
            schema = t["input_schema"]
            assert schema["type"] == "object" and schema.get("additionalProperties") is False
            # Every tool rejects an unexpected field.
            with pytest.raises(toolcheck.ToolCallError):
                toolcheck.validate_call(by, t["name"], {"unexpected": 1})
    with pytest.raises(toolcheck.ToolCallError):
        toolcheck.parse_args('{"price": NaN}')
    with pytest.raises(toolcheck.ToolCallError):
        toolcheck.parse_args("x" * (toolcheck.MAX_ARGS_BYTES + 1))
    assert toolcheck.parse_args("  ") == {}
