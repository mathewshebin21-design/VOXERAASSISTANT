"""Plain-English flow editing, version diffs and call intelligence."""

import copy

from app.flows import instruct
from app.flows.schema import Flow
from app.flows.templates import default_flow
from app.flows.validate import validate

from .test_flow_engine import Call, shop  # noqa: F401  (shop is a fixture)

BASE = default_flow().model_dump(mode="json")


def propose(text: str, g: dict | None = None) -> instruct.Proposal:
    return instruct.interpret(text, copy.deepcopy(g or BASE))


def test_after_hours_message_rule():
    p = propose("When someone calls after 6 PM, offer to take a message.")
    assert p.impact == "high" and "18:00" in p.summary
    assert validate(Flow.model_validate(p.graph)).ok
    cond = next(n for n in p.graph["nodes"] if n["type"] == "condition" and n["id"].startswith("late"))
    assert cond["settings"]["rules"][0] == {
        "id": "late",
        "variable": "now_local",
        "op": "time_after",
        "value": "18:00",
        "label": "after 18:00",
    }
    changes = instruct.diff(BASE, p.graph)
    assert any(c["kind"] == "added_node" for c in changes)
    assert any("Greeting" in c["text"] and "next" in c["text"] for c in changes if c["kind"] == "connection")


def test_ask_preference_before_booking_a_matching_service():
    p = propose("If the customer wants a haircut, ask which barber they prefer.")
    assert validate(Flow.model_validate(p.graph)).ok
    ask = next(n for n in p.graph["nodes"] if n["type"] == "ask" and n["id"].startswith("ask-pref"))
    assert ask["settings"]["question"] == "Which barber they prefer?"
    assert ask["settings"]["variable"].startswith("preferred_barber")


def test_manager_requests_go_to_managers():
    p = propose("If the caller asks for the manager, transfer to available management staff.")
    assert validate(Flow.model_validate(p.graph)).ok
    t = next(n for n in p.graph["nodes"] if n["type"] == "transfer" and n["settings"].get("target") == "managers")
    assert t and any(e["source"] == "route" and e["target"] == t["id"] for e in p.graph["edges"])
    try:
        propose("If the caller asks for the manager, transfer to available management staff.", p.graph)
    except instruct.NotUnderstood as e:
        assert "already" in str(e)
    else:
        raise AssertionError("a duplicate rule should not be added")


def test_no_sunday_appointments_changes_only_the_flow():
    p = propose("Don't accept appointments on Sundays.")
    assert p.impact == "high" and "Sundays" in p.summary
    avail = next(n for n in p.graph["nodes"] if n["type"] == "availability")
    assert avail["settings"]["exclude_weekdays"] == [6]
    assert "opening hours stay" in p.notes[0]


def test_custom_answer_and_greeting_and_not_understood():
    p = propose("If someone asks about parking, say there's free parking behind the shop.")
    assert validate(Flow.model_validate(p.graph)).ok and "parking" in p.summary
    g = propose("Change the greeting to: Hi, you're through to EW Saloon. I'm Ray, the AI receptionist.")
    assert g.graph["nodes"][0]["settings"]["greeting"].startswith("Hi, you're through")
    bad = propose("Change the greeting to: Hello, this is Sarah.")  # hides that it's an AI
    assert not validate(Flow.model_validate(bad.graph)).ok
    try:
        propose("make it sound more like a pirate")
    except instruct.NotUnderstood:
        pass
    else:
        raise AssertionError("unknown instructions must not be guessed at")


def test_instructions_endpoint_proposes_without_saving_and_the_rule_works(shop):  # noqa: F811
    before = shop.get(shop.flow()).json()
    r = shop.post(shop.flow("/instructions"), json={"text": "Don't accept appointments on Sundays."}).json()
    assert r["understood"] and r["requires_confirmation"] and r["validation"]["ok"] and r["changes"]
    assert shop.get(shop.flow()).json()["revision"] == before["revision"]  # nothing saved yet
    saved = shop.put(shop.flow("/draft"), json={"graph": r["graph"], "base_revision": r["base_revision"]})
    assert saved.status_code == 200  # the owner confirmed
    c = Call(shop)
    c.say("can I book a skin fade on sunday")
    offered = [e for e in c.events if e["type"] == "evidence" and e["source"] == "availability"]
    assert all("Sunday" not in Call.said([{"type": "say", "text": e["value"]}]) for e in offered)
    from datetime import datetime

    for e in offered:
        assert all(datetime.fromisoformat(x).weekday() != 6 for x in e["value"].split("; "))
    no = shop.post(shop.flow("/instructions"), json={"text": "make it sound like a pirate"}).json()
    assert no["understood"] is False and no["examples"]
    diff = shop.get(shop.flow("/diff")).json()
    assert diff["base"] is None and diff["changes"]


def test_insights_are_computed_from_sessions_and_labelled(shop):  # noqa: F811
    c = Call(shop)
    c.say("Hi, can I book a beard trim tomorrow")
    c.say("the first one")
    c.say("Sam Lee")
    c.say("yes")
    c2 = Call(shop)
    c2.say("do you sell gift vouchers?")
    r = shop.get(shop.flow("/insights")).json()
    assert r["data"] == "simulation" and "not real callers" in r["label"]
    assert r["conversations"] == 2 and r["outcomes"]["booked"] == 1
    assert r["booking_conversion"] == {"wanted": 1, "booked": 1, "rate": 1.0}
    assert r["knowledge_gaps"][0]["question"] == "do you sell gift vouchers"
    assert r["escalations"] == 1 and r["model"]["tokens"] == 0
    assert shop.get(shop.flow("/insights?mode=live")).json()["conversations"] == 0  # never mixed
    sessions = shop.get(shop.flow("/sessions")).json()
    summary = sessions[-1]["summary"]
    assert any(line["kind"] == "outcome" and "booked" in line["text"] for line in summary)
    got = shop.get(shop.flow(f"/sessions/{sessions[-1]['session_id']}")).json()
    for line in summary:  # every summary line points at real transcript events
        assert all(0 <= i < len(got["transcript"]) for i in line["events"])
