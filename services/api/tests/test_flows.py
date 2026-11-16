"""Agent Studio: flow drafts, validation, publishing, versions, rollback, roles and tenant isolation."""

import copy
import uuid

import pytest
from sqlalchemy import text

from app.db import SessionLocal, set_tenant
from app.flows.schema import Flow
from app.flows.templates import default_flow
from app.flows.validate import validate
from app.routers.flows import published_flow

from .conftest import join

GREETING = "Hi, you're through to Halden & Rye. I'm Rye, the AI receptionist. How can I help?"


@pytest.fixture
def studio(make_account):
    a = make_account("ada@example.com", "Halden & Rye")
    # A realistic workspace, so the standard test scenarios (run before every publish) can pass.
    week = {"intervals": [{"weekday": d, "opens_at": "00:00", "closes_at": "23:59"} for d in range(7)]}
    a.put(a.o("/office-hours"), json=week)
    a.put(a.o("/business-profile"), json={"display_name": "Halden & Rye", "address_line1": "1 Mill Lane"})
    for name, mins, pence in [("Skin fade", 30, 2000), ("Beard trim", 15, 1000)]:
        a.post(a.o("/services"), json={"name": name, "duration_min": mins, "price_from_pence": pence})
    agent = a.post(a.o("/agents"), json={"name": "Rye", "greeting": GREETING}).json()
    a.agent_id = agent["id"]
    a.flow = lambda p="": a.o(f"/agents/{agent['id']}/flow{p}")
    return a


def codes(report: dict) -> set[str]:
    return {i["code"] for i in report["issues"] if i["severity"] == "error"}


def test_new_agent_starts_with_a_valid_publishable_flow(studio):
    r = studio.get(studio.flow())
    assert r.status_code == 200
    body = r.json()
    assert body["revision"] == 1 and body["published_version"] is None and body["draft_differs"] is True
    assert body["validation"]["ok"] is True, body["validation"]
    assert body["draft"]["nodes"][0]["settings"]["greeting"] == GREETING  # the agent's own greeting is kept
    types = {n["type"] for n in body["draft"]["nodes"]}
    assert {"start", "hours_check", "condition", "service_lookup", "availability", "booking", "transfer"} <= types


def test_template_is_valid_and_complete():
    report = validate(default_flow())
    assert report.ok and report.as_dict()["warnings"] == 0, report.as_dict()


def test_autosave_uses_revisions_so_editors_cannot_overwrite_each_other(studio):
    draft = studio.get(studio.flow()).json()["draft"]
    draft["nodes"][0]["label"] = "Hello"
    r = studio.put(studio.flow("/draft"), json={"graph": draft, "base_revision": 1})
    assert r.status_code == 200 and r.json()["revision"] == 2
    stale = studio.put(studio.flow("/draft"), json={"graph": draft, "base_revision": 1})
    assert stale.status_code == 409 and stale.json()["detail"]["revision"] == 2


def test_structurally_broken_documents_are_rejected(studio):
    bad = {"nodes": [{"id": "x", "type": "launch_missiles", "settings": {}}], "edges": []}
    r = studio.put(studio.flow("/draft"), json={"graph": bad, "base_revision": 1})
    assert r.status_code == 422 and r.json()["detail"]["message"] == "Not a valid flow"
    huge = {"nodes": [{"id": f"n{i}", "type": "end"} for i in range(201)], "edges": []}
    assert studio.put(studio.flow("/draft"), json={"graph": huge, "base_revision": 1}).status_code == 422


def test_validation_catches_unsafe_or_incomplete_flows():
    base = default_flow().model_dump(mode="json")

    g = copy.deepcopy(base)  # booking straight after the service is chosen, skipping availability
    for e in g["edges"]:
        if e["source"] == "svc" and e["outcome"] == "found":
            e["target"] = "book"
    assert "booking_without_availability" in codes(validate(Flow.model_validate(g)).as_dict())

    g = copy.deepcopy(base)  # an outcome left unconnected
    g["edges"] = [e for e in g["edges"] if not (e["source"] == "slots" and e["outcome"] == "none")]
    assert "open_outcome" in codes(validate(Flow.model_validate(g)).as_dict())

    g = copy.deepcopy(base)  # a greeting that hides that it's an AI
    g["nodes"][0]["settings"]["greeting"] = "Hello, this is Sarah at reception."
    assert "invalid_settings" in codes(validate(Flow.model_validate(g)).as_dict())

    g = copy.deepcopy(base)  # an edge using an outcome the node doesn't have
    g["edges"].append({"id": "weird", "source": "book", "outcome": "maybe", "target": "bye"})
    assert "unknown_outcome" in codes(validate(Flow.model_validate(g)).as_dict())

    g = copy.deepcopy(base)  # a loop with no exit
    g["nodes"].append({"id": "loop", "type": "respond", "settings": {"message": "Hmm"}})
    g["edges"] = [e for e in g["edges"] if e["source"] != "kb"]
    g["edges"] += [
        {"id": "kb-a", "source": "kb", "outcome": "answered", "target": "loop"},
        {"id": "kb-n", "source": "kb", "outcome": "not_found", "target": "loop"},
        {"id": "loop-n", "source": "loop", "outcome": "next", "target": "kb"},
    ]
    assert "no_way_out" in codes(validate(Flow.model_validate(g)).as_dict())

    g = copy.deepcopy(base)  # two starts
    g["nodes"].append({"id": "start2", "type": "start", "settings": {}})
    assert "start_count" in codes(validate(Flow.model_validate(g)).as_dict())


def test_publish_only_valid_drafts_and_drafts_never_change_what_callers_get(studio):
    state = studio.get(studio.flow()).json()
    broken = copy.deepcopy(state["draft"])
    broken["edges"] = broken["edges"][:-1]
    rev = studio.put(studio.flow("/draft"), json={"graph": broken, "base_revision": 1}).json()["revision"]
    r = studio.post(studio.flow("/publish"), json={"base_revision": rev, "note": "first"})
    assert r.status_code == 422 and r.json()["detail"]["validation"]["errors"] >= 1

    rev = studio.put(studio.flow("/draft"), json={"graph": state["draft"], "base_revision": rev}).json()["revision"]
    assert studio.post(studio.flow("/publish"), json={"base_revision": rev - 1}).status_code == 409  # stale view
    r = studio.post(studio.flow("/publish"), json={"base_revision": rev, "note": "first"})
    assert r.status_code == 200 and r.json()["published_version"] == 1

    # Edit the draft after publishing: the published version is untouched.
    edited = copy.deepcopy(state["draft"])
    edited["nodes"][0]["settings"]["greeting"] = "Hello! I'm the AI receptionist at Halden & Rye."
    studio.put(studio.flow("/draft"), json={"graph": edited, "base_revision": rev})
    org, agent = uuid.UUID(studio.org_id), uuid.UUID(studio.agent_id)
    db = SessionLocal()
    set_tenant(db, org_id=org, user_id=uuid.UUID(studio.user_id))
    version, live = published_flow(db, org, agent)
    db.close()
    assert version == 1 and live.nodes[0].settings["greeting"] == GREETING
    assert studio.get(studio.flow()).json()["draft_differs"] is True


def test_rollback_publishes_an_old_version_again_and_restore_only_touches_the_draft(studio):
    state = studio.get(studio.flow()).json()
    g1 = state["draft"]
    studio.post(studio.flow("/publish"), json={"base_revision": 1, "note": "v1"})
    g2 = copy.deepcopy(g1)
    g2["nodes"][0]["settings"]["greeting"] = "Hello! I'm the AI receptionist at Halden & Rye."
    rev = studio.put(studio.flow("/draft"), json={"graph": g2, "base_revision": 1}).json()["revision"]
    assert studio.post(studio.flow("/publish"), json={"base_revision": rev}).json()["published_version"] == 2

    r = studio.post(studio.flow("/versions/1/rollback"), json={"note": ""})
    assert r.status_code == 200 and r.json()["published_version"] == 3
    v3 = studio.get(studio.flow("/versions/3")).json()
    assert v3["graph"] == studio.get(studio.flow("/versions/1")).json()["graph"]
    latest = r.json()["versions"][0]
    assert latest["source"] == "rollback" and latest["restored_from"] == 1 and latest["note"] == "Rolled back to v1"

    before = studio.get(studio.flow()).json()
    restored = studio.post(studio.flow("/versions/2/restore")).json()
    assert restored["draft"]["nodes"][0]["settings"]["greeting"].startswith("Hello! I'm the AI")
    assert restored["revision"] == before["revision"] + 1 and restored["published_version"] == 3
    assert studio.get(studio.flow("/versions/99")).status_code == 404


def test_published_versions_cannot_be_edited_even_by_the_api_role(studio, app_engine):
    studio.get(studio.flow())
    studio.post(studio.flow("/publish"), json={"base_revision": 1})
    with app_engine.connect() as c:
        c.execute(text("SELECT set_config('app.org_id', :o, false)"), {"o": studio.org_id})
        with pytest.raises(Exception, match="permission denied"):
            c.execute(text("UPDATE agent_flow_versions SET note = 'tampered'"))


@pytest.mark.parametrize("role", ["admin", "manager", "staff", "viewer"])
def test_roles(studio, make_account, role):
    m = make_account(f"{role}@example.com", "Mine")
    join(studio, m, role)
    m.org_id = studio.org_id
    url = lambda p="": m.o(f"/agents/{studio.agent_id}/flow{p}")  # noqa: E731
    assert m.get(url()).status_code == 200  # everyone in the workspace can look
    draft = m.get(url()).json()["draft"]
    can_edit = role == "admin"
    assert (m.put(url("/draft"), json={"graph": draft, "base_revision": 1}).status_code == 200) is can_edit
    assert (m.post(url("/publish"), json={"base_revision": 2 if can_edit else 1}).status_code == 200) is can_edit


def test_other_workspaces_cannot_see_or_touch_a_flow(studio, make_account, app_engine):
    studio.get(studio.flow())
    other = make_account("bo@example.com", "Other")
    url = f"/v1/orgs/{studio.org_id}/agents/{studio.agent_id}/flow"
    assert other.get(url).status_code == 404
    assert other.put(f"{url}/draft", json={"graph": {"nodes": []}, "base_revision": 1}).status_code == 404
    # Their own workspace path can't reach our agent either.
    assert other.get(other.o(f"/agents/{studio.agent_id}/flow")).status_code == 404
    with app_engine.connect() as c:  # and row-level security hides the rows outright
        c.execute(text("SELECT set_config('app.org_id', :o, false)"), {"o": other.org_id})
        assert c.execute(text("SELECT count(*) FROM agent_flows")).scalar() == 0
