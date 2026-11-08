"""Call records: lifecycle, append-only transcript, consent, tenant isolation, retention, erasure,
and live-brain turns recorded into a simulated call."""

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from .conftest import join
from .test_live import events as sse_events
from .test_live import (
    live,  # noqa: F401  (fixture)
    message,
    setup_business,
)


def start(a, **kw):
    body = {"channel": "simulated", "ai_disclosure_played": True, "recording_notice_played": True, **kw}
    r = a.post(a.o("/calls"), json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def say(a, call_id, *evs):
    return a.post(a.o(f"/calls/{call_id}/events"), json={"events": list(evs)})


CALLER = {"kind": "utterance", "speaker": "caller", "text": "Hi, do you do balayage?"}
AGENT = {"kind": "utterance", "speaker": "agent", "text": "We do, from £165."}


# ---- lifecycle -------------------------------------------------------------------------------


def test_full_lifecycle_with_summary_and_audit(make_account):
    a = make_account("ada@example.com")
    c = start(a, caller_number="+44 117 496 0000", caller_name="Sam")
    assert (c["status"], c["event_count"], c["ended_at"], c["audio_stored"]) == ("in_progress", 0, None, False)
    r = say(a, c["id"], CALLER, {"kind": "tool", "speaker": "agent", "data": {"name": "list_services", "ok": True}})
    assert r.status_code == 201 and [e["seq"] for e in r.json()] == [1, 2]
    assert say(a, c["id"], AGENT).json()[0]["seq"] == 3
    r = a.post(a.o(f"/calls/{c['id']}/end"), json={"status": "completed", "outcome": "answered"})
    assert r.status_code == 200, r.text
    ended = r.json()
    assert ended["status"] == "completed" and ended["outcome"] == "answered" and ended["ended_at"]
    s = ended["summary"]
    assert (s["caller_turns"], s["agent_turns"], s["tools"], s["events"]) == (1, 1, {"list_services": 1}, 3)
    detail = a.get(a.o(f"/calls/{c['id']}")).json()
    assert [e["text"] for e in detail["events"]] == [CALLER["text"], None, AGENT["text"]]
    actions = [x["action"] for x in a.get(a.o("/audit-logs")).json()]
    assert {"call.started", "call.ended"} <= set(actions)


def test_a_call_ends_once_and_takes_no_events_afterwards(make_account):
    a = make_account("ada@example.com")
    c = start(a)
    assert a.post(a.o(f"/calls/{c['id']}/end"), json={"status": "failed", "reason": "test"}).status_code == 200
    assert a.post(a.o(f"/calls/{c['id']}/end"), json={"status": "completed"}).status_code == 409
    assert say(a, c["id"], CALLER).status_code == 409


def test_start_is_idempotent_on_external_ref(make_account):
    a = make_account("ada@example.com")
    first = a.post(
        a.o("/calls"), json={"channel": "simulated", "external_ref": "sim-0001-abc", "recording_notice_played": True}
    )
    again = a.post(a.o("/calls"), json={"channel": "simulated", "external_ref": "sim-0001-abc"})
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]


def test_phone_calls_cannot_be_created_through_the_member_api(make_account):
    a = make_account("ada@example.com")
    assert a.post(a.o("/calls"), json={"channel": "phone"}).status_code == 422


@pytest.mark.parametrize(
    "event",
    [
        {"kind": "audio", "speaker": "caller"},
        {"kind": "utterance", "speaker": "robot"},
        {"kind": "utterance", "text": "x" * 4001},
        {"kind": "system", "extra": 1},
    ],
)
def test_bad_events_are_rejected(make_account, event):
    a = make_account("ada@example.com")
    c = start(a)
    assert say(a, c["id"], event).status_code == 422


def test_event_data_size_is_limited(make_account):
    a = make_account("ada@example.com")
    c = start(a)
    assert say(a, c["id"], {"kind": "system", "data": {"blob": "x" * 2100}}).status_code == 422
    assert a.get(a.o(f"/calls/{c['id']}")).json()["event_count"] == 0  # nothing partial was kept


def test_concurrent_appends_get_unique_gap_free_sequence_numbers(make_account):
    a = make_account("ada@example.com")
    c = start(a)
    barrier = threading.Barrier(8)

    def add(_):
        barrier.wait()
        return say(a, c["id"], CALLER, AGENT).status_code

    with ThreadPoolExecutor(8) as pool:
        assert set(pool.map(add, range(8))) == {201}
    seqs = [e["seq"] for e in a.get(a.o(f"/calls/{c['id']}")).json()["events"]]
    assert seqs == list(range(1, 17))


def test_list_filters_and_pages_newest_first(make_account):
    a = make_account("ada@example.com")
    ids = [start(a)["id"] for _ in range(3)]
    a.post(a.o(f"/calls/{ids[0]}/end"), json={"status": "completed"})
    listed = a.get(a.o("/calls")).json()
    assert [c["id"] for c in listed] == ids[::-1] and "events" not in listed[0]
    assert [c["id"] for c in a.get(a.o("/calls?status=completed")).json()] == [ids[0]]
    page = a.get(a.o("/calls"), params={"limit": 1}).json()
    rest = a.get(a.o("/calls"), params={"before": page[0]["started_at"]}).json()
    assert [c["id"] for c in page + rest] == ids[::-1]


# ---- consent -----------------------------------------------------------------------------------


def test_without_the_recording_notice_no_words_are_stored(make_account, owner_engine):
    a = make_account("ada@example.com")
    c = start(a, recording_notice_played=False)
    assert c["transcript_retained"] is False
    say(a, c["id"], CALLER, AGENT)
    evs = a.get(a.o(f"/calls/{c['id']}")).json()["events"]
    assert [(e["text"], e["data"].get("text_withheld")) for e in evs] == [(None, True), (None, True)]
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM call_events WHERE text IS NOT NULL")).scalar() == 0


def test_an_event_cannot_point_at_another_workspaces_call(owner_engine, make_account):
    a, b = make_account("a@example.com"), make_account("b@example.com")
    c = start(a)
    with pytest.raises(DBAPIError, match="fk_call_event_call_same_org"), owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO call_events (organization_id, call_id, seq, kind) VALUES (:o, :c, 1, 'system')"),
            {"o": b.org_id, "c": c["id"]},
        )


def test_audio_can_never_be_marked_stored(owner_engine, make_account):
    a = make_account("ada@example.com")
    c = start(a)
    with pytest.raises(DBAPIError, match="ck_call_no_audio"), owner_engine.begin() as conn:
        conn.execute(text("UPDATE calls SET audio_stored = true WHERE id = :i"), {"i": c["id"]})


# ---- permissions and tenancy ----------------------------------------------------------------


def test_roles(client, make_account):
    owner = make_account("owner@example.com")
    viewer = make_account("viewer@example.com")
    join(owner, viewer, "viewer")
    c = start(owner)
    viewer.org_id = owner.org_id
    assert viewer.get(viewer.o(f"/calls/{c['id']}")).status_code == 200  # read
    assert viewer.post(viewer.o("/calls"), json={"channel": "simulated"}).status_code == 403
    assert say(viewer, c["id"], CALLER).status_code == 403
    assert viewer.post(viewer.o(f"/calls/{c['id']}/end"), json={}).status_code == 403
    assert viewer.delete(viewer.o(f"/calls/{c['id']}")).status_code == 403


def test_another_workspace_cannot_see_or_touch_a_call(make_account):
    a, b = make_account("a@example.com"), make_account("b@example.com")
    c = start(a)
    say(a, c["id"], CALLER)
    assert b.get(b.o(f"/calls/{c['id']}")).status_code == 404
    assert say(b, c["id"], CALLER).status_code == 404
    assert b.post(b.o(f"/calls/{c['id']}/end"), json={}).status_code == 404
    assert b.get(b.o("/calls")).json() == []


def test_rls_hides_calls_without_a_tenant_and_events_are_append_only(app_engine, make_account):
    a = make_account("ada@example.com")
    c = start(a)
    say(a, c["id"], CALLER)
    with app_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM calls")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM call_events")).scalar() == 0
    for sql in ("UPDATE call_events SET text = 'changed'", "DELETE FROM call_events"):
        with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": a.org_id})
            conn.execute(text(sql))


# ---- erasure, export, retention ---------------------------------------------------------------


def test_owner_erases_a_call_and_its_transcript(make_account, owner_engine):
    a = make_account("ada@example.com")
    c = start(a)
    say(a, c["id"], CALLER, AGENT)
    assert a.delete(a.o(f"/calls/{c['id']}")).status_code == 204
    assert a.get(a.o(f"/calls/{c['id']}")).status_code == 404
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM call_events")).scalar() == 0
        details = conn.execute(text("SELECT details::text FROM audit_logs WHERE action = 'call.deleted'")).scalar()
    assert "balayage" not in details.lower()


def test_workspace_export_includes_calls(make_account):
    a = make_account("ada@example.com")
    c = start(a)
    say(a, c["id"], CALLER)
    data = a.get(a.o("/export")).json()
    assert [x["id"] for x in data["calls"]] == [c["id"]] and data["call_events"][0]["text"] == CALLER["text"]


def test_housekeeping_purges_by_each_workspace_retention_and_abandons_idle_calls(
    app_engine, owner_engine, make_account
):
    a, b = make_account("a@example.com"), make_account("b@example.com")
    old_a, new_a, old_b, idle = start(a), start(a), start(b), start(b)
    say(a, old_a["id"], CALLER)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE workspace_settings SET recording_retention_days = 7 WHERE organization_id = :o"),
            {"o": a.org_id},
        )
        conn.execute(
            text("UPDATE workspace_settings SET recording_retention_days = 30 WHERE organization_id = :o"),
            {"o": b.org_id},
        )
        ago = "UPDATE calls SET started_at = now() - CAST(:d AS interval), last_activity_at = now() - CAST(:d AS interval)"
        conn.execute(text(ago + " WHERE id = :i"), {"d": "8 days", "i": old_a["id"]})  # past A's 7 days
        conn.execute(text(ago + " WHERE id = :i"), {"d": "8 days", "i": old_b["id"]})  # within B's 30 days
        conn.execute(text(ago + " WHERE id = :i"), {"d": "3 hours", "i": idle["id"]})
    with app_engine.begin() as conn:  # the runtime role, with no tenant set
        purged, abandoned = conn.execute(text("SELECT purged, abandoned FROM call_housekeeping(100)")).one()
    assert purged == 1  # old_a only
    assert abandoned == 2  # old_b and idle had no activity for over two hours
    assert a.get(a.o(f"/calls/{old_a['id']}")).status_code == 404
    assert a.get(a.o(f"/calls/{new_a['id']}")).json()["status"] == "in_progress"
    assert b.get(b.o(f"/calls/{idle['id']}")).json()["status"] == "abandoned"
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM call_events")).scalar() == 0


def test_housekeeping_rejects_a_bad_limit(app_engine):
    with pytest.raises(DBAPIError, match="invalid limit"), app_engine.begin() as conn:
        conn.execute(text("SELECT * FROM call_housekeeping(0)"))


def test_deleting_the_workspace_removes_its_calls(make_account, owner_engine):
    a = make_account("ada@example.com")
    c = start(a)
    say(a, c["id"], CALLER)
    with owner_engine.begin() as conn:  # what workspace deletion does at the database level
        conn.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": a.org_id})
        assert conn.execute(text("SELECT count(*) FROM calls")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM call_events")).scalar() == 0


def test_migration_0011_round_trip(owner_engine):
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.environ["VOXERA_MIGRATION_DATABASE_URL"])
    try:
        command.downgrade(cfg, "0010")
        with owner_engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('public.calls')")).scalar() is None
    finally:
        command.upgrade(cfg, "head")
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.call_events')")).scalar() is not None


# ---- live brain turns recorded into a simulated call ----------------------------------------


def test_brain_turns_are_recorded_into_the_call(live, make_account):  # noqa: F811
    a = make_account("ada@example.com")
    setup_business(a)
    c = start(a)
    live["llm"] = [
        (200, message([("tool", {"id": "t1", "name": "list_services"})], "tool_use", 50, 5)),
        (200, message([("text", {"parts": ["We do balayage ", "from £165."]})], "end_turn", 60, 8)),
    ]
    body = {
        "request_id": f"r-{uuid.uuid4().hex[:12]}",
        "call_id": c["id"],
        "messages": [{"role": "user", "text": "Do you do balayage?"}],
    }
    r = a.post(a.o("/live/brain"), json=body)
    assert r.status_code == 200 and sse_events(r)[-1]["type"] == "done"
    evs = a.get(a.o(f"/calls/{c['id']}")).json()["events"]
    assert [(e["kind"], e["speaker"]) for e in evs] == [
        ("utterance", "caller"),
        ("tool", "agent"),
        ("utterance", "agent"),
    ]
    assert evs[0]["text"] == "Do you do balayage?" and evs[2]["text"] == "We do balayage from £165."
    assert evs[1]["data"] == {"name": "list_services", "ok": True}
    assert evs[2]["data"]["metrics"]["rounds"] == 2
    ended = a.post(a.o(f"/calls/{c['id']}/end"), json={"status": "completed", "outcome": "answered"}).json()
    assert ended["summary"]["tokens"]["output"] == 13


def test_brain_refuses_an_ended_or_foreign_call_before_spending(live, make_account):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com")
    c = start(a)
    a.post(a.o(f"/calls/{c['id']}/end"), json={"status": "completed"})
    body = {"request_id": "r-ended-0001", "call_id": c["id"], "messages": [{"role": "user", "text": "Hello?"}]}
    assert a.post(a.o("/live/brain"), json=body).status_code == 409
    other = start(a)
    body = {"request_id": "r-foreign-01", "call_id": other["id"], "messages": [{"role": "user", "text": "Hello?"}]}
    assert b.post(b.o("/live/brain"), json=body).status_code == 404
    assert live["llm_requests"] == []
