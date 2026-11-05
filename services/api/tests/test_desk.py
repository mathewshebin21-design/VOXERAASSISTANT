"""Reception desk: availability and bookings, the shared case queue worked by several employees,
and the AI receptionist's booking / message / transfer tools (LLM faked at the transport layer)."""

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from .conftest import join
from .test_live import brain_body, events, live, message  # noqa: F401  (live is a fixture)

LONDON = ZoneInfo("Europe/London")
ALL_WEEK = {"intervals": [{"weekday": d, "opens_at": "00:00", "closes_at": "23:59"} for d in range(7)]}
NINE_TO_FIVE = {"intervals": [{"weekday": d, "opens_at": "09:00", "closes_at": "17:00"} for d in range(7)]}


def next_week_at(hour: int, minute: int = 0) -> datetime:
    day = datetime.now(LONDON).date() + timedelta(days=7)
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=LONDON)


def setup_salon(a, hours=NINE_TO_FIVE, capacity=1) -> str:
    assert a.put(a.o("/office-hours"), json=hours).status_code == 200
    assert a.patch(a.o("/settings"), json={"booking_capacity": capacity}).status_code == 200
    r = a.post(
        a.o("/services"), json={"name": "Cut & Finish", "duration_min": 60, "buffer_min": 15, "price_from_pence": 4500}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def book(a, svc, start, phone="07700 900123", name="Priya Shah"):
    return a.post(
        a.o("/appointments"),
        json={"service_id": svc, "starts_at": start.isoformat(), "customer_name": name, "customer_phone": phone},
    )


# ---------- availability & bookings ----------


def test_availability_respects_hours_duration_buffer_and_capacity(make_account):
    a = make_account("ada@example.com")
    svc = setup_salon(a)
    day = next_week_at(9).date()
    slots = [datetime.fromisoformat(s) for s in a.get(a.o(f"/availability?service_id={svc}&on={day}")).json()["slots"]]
    assert slots[0].astimezone(LONDON).hour == 9
    assert all(s.astimezone(LONDON) + timedelta(minutes=60) <= next_week_at(17) for s in slots)
    assert book(a, svc, next_week_at(10)).status_code == 201
    # 10:00–11:00 plus a 15-minute buffer: 09:15–11:00 starts now clash, 11:15 is free.
    for clash in (next_week_at(9, 15), next_week_at(10, 30), next_week_at(11)):
        r = book(a, svc, clash, name="Other")
        assert r.status_code == 409, clash
    assert book(a, svc, next_week_at(11, 15), name="Other").status_code == 201
    assert book(a, svc, next_week_at(16, 30)).status_code == 409  # runs past closing
    assert book(a, svc, next_week_at(10, 10)).status_code == 409  # not on the quarter hour


def test_capacity_allows_parallel_bookings(make_account):
    a = make_account("ada@example.com")
    svc = setup_salon(a, capacity=2)
    assert book(a, svc, next_week_at(10)).status_code == 201
    assert book(a, svc, next_week_at(10), name="B").status_code == 201
    assert book(a, svc, next_week_at(10), name="C").status_code == 409
    listed = a.get(a.o("/appointments")).json()
    assert len(listed) == 2 and listed[0]["source"] == "staff"


def test_cancel_frees_the_slot_and_viewers_cannot_book(make_account):
    a = make_account("ada@example.com")
    v = make_account("vic@example.com", "V")
    join(a, v, "viewer")
    v.org_id = a.org_id
    svc = setup_salon(a)
    appt = book(a, svc, next_week_at(10)).json()
    assert book(v, svc, next_week_at(13)).status_code == 403
    assert a.post(a.o(f"/appointments/{appt['id']}/cancel")).json()["status"] == "cancelled"
    assert book(a, svc, next_week_at(10)).status_code == 201


# ---------- the staff desk: several employees at once ----------


def desk_team(owner, *names):
    people = []
    for n in names:
        m = owner.client and __import__("tests.conftest", fromlist=["Account"]).Account(
            owner.client, f"{n}@example.com", n
        )
        join(owner, m, "staff")
        m.org_id = owner.org_id
        people.append(m)
    return people


def ai_transfer(a, live, summary="Wants to discuss a complaint"):  # noqa: F811
    tool = ("tool", {"id": "toolu_t", "name": "transfer_to_staff"})
    live["llm"] += [
        (200, message([tool], "tool_use", 500, 20)),
        (200, message([("text", {"parts": ["Putting you through."]})], "end_turn", 600, 8)),
    ]
    # The fake API returns the tool call with empty input; patch the input via the transport is overkill —
    # instead the handler below fills it in (see ai_input).
    return a.post(a.o("/live/brain"), json={**brain_body(), "messages": [{"role": "user", "text": summary}]})


@pytest.fixture
def tool_input(monkeypatch):
    """Lets a test choose the arguments the fake model passes to a tool call."""
    import app.routers.live as live_router

    inputs: dict[str, dict] = {}
    real = live_router._exec_tool  # swap the model's arguments in before validation, so they are still checked
    monkeypatch.setattr(
        live_router, "_exec_tool", lambda tdb, run, by, name, args: real(tdb, run, by, name, inputs.get(name, args))
    )
    return inputs


def test_staff_role_works_the_desk_but_cannot_change_settings(make_account):
    owner = make_account("ada@example.com")
    (sam,) = desk_team(owner, "sam")
    assert sam.put(sam.o("/desk/presence"), json={"status": "available"}).status_code == 200
    assert sam.patch(sam.o("/settings"), json={"booking_capacity": 3}).status_code == 403
    team = {m["full_name"]: m for m in owner.get(owner.o("/desk/team")).json()}
    assert team["Sam"]["status"] == "available" and team["Ada"]["status"] == "offline"


def test_transfers_go_to_the_least_busy_available_employee(make_account, live, tool_input):  # noqa: F811
    owner = make_account("ada@example.com")
    setup_salon(owner, hours=ALL_WEEK)
    sam, kim = desk_team(owner, "sam", "kim")
    for m in (sam, kim):
        m.put(m.o("/desk/presence"), json={"status": "available"})
    tool_input["transfer_to_staff"] = {
        "reason": "complaint",
        "summary": "Unhappy with colour, wants to speak to someone",
        "caller_name": "Jo",
        "caller_phone": "07700900111",
        "urgent": False,
    }
    ev = events(ai_transfer(owner, live))
    handoff = next(e for e in ev if e["type"] == "handoff")
    first = handoff["staff"]
    assert handoff["outcome"] == "transferred" and first in ("Sam", "Kim")
    # The first person is now busy (on the call): the next transfer goes to the other one.
    ev2 = events(ai_transfer(owner, live))
    second = next(e for e in ev2 if e["type"] == "handoff")["staff"]
    assert {first, second} == {"Sam", "Kim"}
    # Nobody free → queued for the next available person.
    ev3 = events(ai_transfer(owner, live))
    assert next(e for e in ev3 if e["type"] == "handoff")["outcome"] == "queued"
    cases = owner.get(owner.o("/cases")).json()
    assert len(cases) == 3 and sum(c["status"] == "new" for c in cases) == 1
    assert {c["assignee_name"] for c in cases if c["status"] == "in_progress"} == {"Sam", "Kim"}
    assert cases[0]["summary"].startswith("Unhappy with colour")


def test_outside_hours_a_transfer_becomes_a_callback(make_account, live, tool_input):  # noqa: F811
    owner = make_account("ada@example.com")
    owner.put(owner.o("/office-hours"), json={"intervals": []})
    (sam,) = desk_team(owner, "sam")
    sam.put(sam.o("/desk/presence"), json={"status": "available"})
    tool_input["transfer_to_staff"] = {
        "reason": "wants a person",
        "summary": "Asked for a human",
        "caller_name": None,
        "caller_phone": "07700900111",
        "urgent": False,
    }
    ev = events(ai_transfer(owner, live))
    assert next(e for e in ev if e["type"] == "handoff")["outcome"] == "callback"
    assert owner.get(owner.o("/cases")).json()[0]["kind"] == "callback"


def test_claiming_is_first_come_first_served_and_cases_have_notes(make_account):
    owner = make_account("ada@example.com")
    sam, kim = desk_team(owner, "sam", "kim")
    case = owner.post(
        owner.o("/cases"),
        json={"summary": "Call back about gift vouchers", "caller_phone": "07700900222", "assign_to_me": False},
    ).json()
    assert case["status"] == "new"
    assert sam.post(sam.o(f"/cases/{case['id']}/claim")).status_code == 200
    r = kim.post(kim.o(f"/cases/{case['id']}/claim"))
    assert r.status_code == 409 and "Sam" in r.json()["detail"]
    sam.post(sam.o(f"/cases/{case['id']}/notes"), json={"body": "Left voicemail"})
    kim.post(kim.o(f"/cases/{case['id']}/notes"), json={"body": "Customer rang back, sold £50 voucher"})
    done = sam.post(sam.o(f"/cases/{case['id']}/resolve"), json={"resolution": "Voucher sold"}).json()
    assert done["status"] == "resolved" and [n["author_name"] for n in done["notes"]] == ["Sam", "Kim"]
    assert sam.get(sam.o("/cases?mine=true&status=resolved")).json()[0]["id"] == case["id"]
    assert sam.post(sam.o(f"/cases/{case['id']}/reopen")).json()["status"] == "in_progress"
    # Reassign to Kim, then back to the queue.
    assert (
        sam.post(sam.o(f"/cases/{case['id']}/assign"), json={"user_id": kim.user_id}).json()["assignee_name"] == "Kim"
    )
    assert sam.post(sam.o(f"/cases/{case['id']}/assign"), json={"user_id": None}).json()["status"] == "new"


def test_resolving_a_transferred_call_frees_the_employee(make_account, live, tool_input):  # noqa: F811
    owner = make_account("ada@example.com")
    owner.put(owner.o("/office-hours"), json=ALL_WEEK)
    (sam,) = desk_team(owner, "sam")
    sam.put(sam.o("/desk/presence"), json={"status": "available"})
    tool_input["transfer_to_staff"] = {
        "reason": "r",
        "summary": "s",
        "caller_name": None,
        "caller_phone": None,
        "urgent": True,
    }
    events(ai_transfer(owner, live))
    assert {m["full_name"]: m["status"] for m in owner.get(owner.o("/desk/team")).json()}["Sam"] == "busy"
    case = sam.get(sam.o("/cases?mine=true")).json()[0]
    sam.post(sam.o(f"/cases/{case['id']}/resolve"), json={"resolution": "Sorted on the phone"})
    assert {m["full_name"]: m["status"] for m in owner.get(owner.o("/desk/team")).json()}["Sam"] == "available"


def test_case_notes_are_append_only_for_the_api_role(make_account, app_engine):
    owner = make_account("ada@example.com")
    case = owner.post(owner.o("/cases"), json={"summary": "x"}).json()
    owner.post(owner.o(f"/cases/{case['id']}/notes"), json={"body": "first"})
    from sqlalchemy.exc import DBAPIError

    with app_engine.connect() as c, c.begin():
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": owner.org_id})
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("UPDATE case_notes SET body = 'edited'"))


def test_desk_is_tenant_isolated(make_account):
    a = make_account("ada@example.com")
    b = make_account("bo@example.com", "Other")
    case = a.post(a.o("/cases"), json={"summary": "private"}).json()
    assert b.get(f"/v1/orgs/{a.org_id}/cases").status_code == 404
    assert b.post(b.o(f"/cases/{case['id']}/claim")).status_code == 404
    assert b.get(b.o("/cases")).json() == []


# ---------- the AI receptionist's tools ----------


def test_ai_books_only_after_a_clear_yes_and_is_idempotent(make_account, live, tool_input):  # noqa: F811
    a = make_account("ada@example.com")
    setup_salon(a)
    start = next_week_at(14, 30)
    tool_input["book_appointment"] = {
        "service_name": "cut",
        "start": start.strftime("%Y-%m-%dT%H:%M"),
        "customer_name": "Priya Shah",
        "customer_phone": "07700 900123",
        "notes": None,
    }
    call = ("tool", {"id": "toolu_b", "name": "book_appointment"})

    def turn(said: str):
        live["llm"] += [
            (200, message([call], "tool_use", 500, 20)),
            (200, message([("text", {"parts": ["Okay."]})], "end_turn", 500, 5)),
        ]
        body = {
            "request_id": f"t-{len(live['llm_requests'])}-xyzw",
            "conversation_id": "call-0001-abcd",
            "messages": [{"role": "user", "text": said}],
        }
        return events(a.post(a.o("/live/brain"), json=body))

    for said in (
        "Friday at half two would be great, could you check?",
        "Hmm, not sure, hang on",
        "Yes, is that with Isla?",
    ):
        tool = next(e for e in turn(said) if e["type"] == "tool")
        assert tool["ok"] is False and "confirm" in tool["result"], said
    assert a.get(a.o("/appointments")).json() == []
    ev = turn("Yes please, book it")
    tool = next(e for e in ev if e["type"] == "tool")
    assert tool["ok"] is True and "booked" in tool["result"]
    ev = turn("Yes please, book it")  # a retried turn doesn't double-book
    appts = a.get(a.o("/appointments")).json()
    assert len(appts) == 1 and appts[0]["source"] == "ai_receptionist" and appts[0]["service_name"] == "Cut & Finish"


def test_ai_moves_in_place_only_after_confirmation(make_account, live, tool_input):  # noqa: F811
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    tool_input["reschedule_appointment"] = {
        "appointment_ref": original["id"][:8],
        "customer_phone": "07700900123",
        "new_start": next_week_at(10, 30).strftime("%Y-%m-%dT%H:%M"),
    }
    tool = ("tool", {"id": "toolu_move", "name": "reschedule_appointment"})
    for said, expected in [("Could it be a little later?", False), ("yes, move it", True)]:
        live["llm"] += [
            (200, message([tool], "tool_use", 500, 20)),
            (200, message([("text", {"parts": ["Anything else?"]})], "end_turn", 500, 8)),
        ]
        ev = events(
            a.post(a.o("/live/brain"), json={**brain_body(), "messages": [{"role": "user", "text": said}]})
        )
        assert next(e for e in ev if e["type"] == "tool")["ok"] is expected
        rows = a.get(a.o("/appointments?include_cancelled=true")).json()
        assert len(rows) == 1 and rows[0]["id"] == original["id"]
        assert datetime.fromisoformat(rows[0]["starts_at"]) == next_week_at(10, 30 if expected else 0)


def test_ai_can_only_see_and_cancel_the_callers_own_bookings(make_account, live, tool_input):  # noqa: F811
    a = make_account("ada@example.com")
    svc = setup_salon(a)
    mine = book(a, svc, next_week_at(10), phone="+44 7700 900123").json()
    other = book(a, svc, next_week_at(13), phone="07700 900999", name="Someone Else").json()
    find = ("tool", {"id": "toolu_f", "name": "find_my_appointments"})
    tool_input["find_my_appointments"] = {"customer_phone": "07700900123"}
    live["llm"] += [
        (200, message([find], "tool_use", 500, 20)),
        (200, message([("text", {"parts": ["Found it."]})], "end_turn", 500, 5)),
    ]
    ev = events(
        a.post(
            a.o("/live/brain"), json={**brain_body(), "messages": [{"role": "user", "text": "It's under 07700 900123"}]}
        )
    )
    found = json.loads(next(e for e in ev if e["type"] == "tool")["result"])["appointments"]
    assert [x["ref"] for x in found] == [mine["id"][:8]]
    cancel = ("tool", {"id": "toolu_c", "name": "cancel_appointment"})
    tool_input["cancel_appointment"] = {"appointment_ref": other["id"][:8], "customer_phone": "07700900123"}
    live["llm"] += [
        (200, message([cancel], "tool_use", 500, 20)),
        (200, message([("text", {"parts": ["Hmm."]})], "end_turn", 500, 5)),
    ]
    ev = events(
        a.post(a.o("/live/brain"), json={**brain_body(), "messages": [{"role": "user", "text": "Yes, cancel it"}]})
    )
    assert next(e for e in ev if e["type"] == "tool")["ok"] is False
    assert {x["status"] for x in a.get(a.o("/appointments?include_cancelled=true")).json()} == {"booked"}


def test_ai_takes_a_message_into_the_shared_queue(make_account, live, tool_input):  # noqa: F811
    a = make_account("ada@example.com")
    tool_input["take_message"] = {
        "caller_name": "Tom",
        "caller_phone": "07700900333",
        "message": "Can someone call about bridal hair for 6 people?",
        "urgent": False,
    }
    call = ("tool", {"id": "toolu_m", "name": "take_message"})
    live["llm"] += [
        (200, message([call], "tool_use", 500, 20)),
        (200, message([("text", {"parts": ["Done."]})], "end_turn", 500, 5)),
    ]
    events(a.post(a.o("/live/brain"), json=brain_body()))
    case = a.get(a.o("/cases")).json()[0]
    assert case["kind"] == "message" and case["status"] == "new" and case["caller_phone"] == "07700900333"


@pytest.mark.parametrize(
    ("said", "ok"),
    [
        ("Yes please", True),
        ("Yeah, go ahead", True),
        ("Um, yes that's right", True),
        ("That's perfect, thanks", True),
        ("Book it", True),
        ("Okay", True),
        ("No", False),
        ("Yes — actually wait", False),
        ("Not that one", False),
        ("Is that with Isla?", False),
        ("Friday would be great", False),
        ("I'd like to book a cut", False),
        ("", False),
    ],
)
def test_consent_detection(said, ok):
    from app.live.receptionist import affirmed

    assert affirmed(said) is ok
