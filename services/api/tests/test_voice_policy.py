"""A workspace's saved voice policy and its telephone numbers (migration 0012).

- The policy is stored per workspace, validated exactly as routing uses it, readable by everyone in
  the workspace and changeable only by owners and admins.
- Numbers can only be assigned by an operator: the API's runtime role can read its own workspace's
  numbers and nothing else, so no workspace can claim a number that reaches another business.
- A telephone call is recorded only for a number that is active for the token's workspace, and the
  refusal is the same whoever owns the number.
"""

import argparse
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app import worker_auth
from app.voice import launch

from .conftest import join
from .test_worker_auth import worker  # noqa: F401  (fixture)
from .test_worker_calls import _h, _start, assign_number

POLICY = {
    "default_language": "en-GB",
    "languages": ["en-GB", "hi-IN"],
    "fallback_language": "en-GB",
    "allowed_regions": ["device", "uk", "eu"],
    "blocked_providers": ["deepgram"],
    "preferred_providers": ["kokoro"],
    "allow_paid": False,
    "allow_unverified": False,
}


def _launch_ready(monkeypatch, a):
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)


# ---- the policy ----------------------------------------------------------------------------------


def test_a_new_workspace_uses_the_defaults_until_it_saves_a_policy(make_account):
    a = make_account("a@example.com")
    got = a.get(a.o("/voice/policy")).json()
    assert got["saved"] is False and got["default_language"] == "en-GB" and got["languages"] == ["en-GB"]


def test_owner_saves_a_policy_and_it_is_audited(make_account, owner_engine):
    a = make_account("a@example.com")
    r = a.put(a.o("/voice/policy"), json=POLICY)
    assert r.status_code == 200, r.text
    got = a.get(a.o("/voice/policy")).json()
    assert got == {**POLICY, "saved": True, "allowed_regions": ["device", "eu", "uk"]}
    # Saving again replaces it (one row per workspace).
    assert a.put(a.o("/voice/policy"), json={**POLICY, "languages": ["en-GB"]}).status_code == 200
    assert a.get(a.o("/voice/policy")).json()["languages"] == ["en-GB"]
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM voice_policies")).scalar() == 1
        changed = (
            c.execute(
                text(
                    "SELECT details->'changed' FROM audit_logs WHERE action = 'voice_policy.updated' ORDER BY created_at"
                )
            )
            .scalars()
            .all()
        )
    assert changed[-1] == ["languages"]


@pytest.mark.parametrize("role", ["manager", "staff", "viewer"])
def test_only_owners_and_admins_change_the_policy(make_account, role):
    a, m = make_account("a@example.com"), make_account("m@example.com", "Other")
    join(a, m, role)
    assert m.get(a.o("/voice/policy")).status_code == 200
    assert m.put(a.o("/voice/policy"), json=POLICY).status_code == 403


def test_admin_may_change_the_policy(make_account):
    a, m = make_account("a@example.com"), make_account("m@example.com", "Other")
    join(a, m, "admin")
    assert m.put(a.o("/voice/policy"), json=POLICY).status_code == 200


@pytest.mark.parametrize(
    "change",
    [
        {"languages": ["en-GB", "xx-XX"]},  # unknown language
        {"default_language": "hi-IN", "languages": ["en-GB"]},  # default not offered
        {"fallback_language": "ml-IN"},  # fallback not offered
        {"languages": ["en-GB", "en-GB"]},  # duplicate
        {"allowed_regions": []},
        {"allowed_regions": ["mars"]},
        {"blocked_providers": ["nobody"]},
        {"blocked_providers": ["kokoro"], "preferred_providers": ["kokoro"]},  # both
    ],
)
def test_invalid_policies_are_refused_and_nothing_is_saved(make_account, change):
    a = make_account("a@example.com")
    assert a.put(a.o("/voice/policy"), json={**POLICY, **change}).status_code == 422
    assert a.get(a.o("/voice/policy")).json()["saved"] is False


def test_one_workspace_never_sees_another_workspaces_policy(make_account, app_engine):
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    a.put(a.o("/voice/policy"), json=POLICY)
    assert b.get(b.o("/voice/policy")).json()["saved"] is False
    assert b.get(a.o("/voice/policy")).status_code in (403, 404)
    with app_engine.connect() as c:  # no tenant set: the runtime role sees no rows
        assert c.execute(text("SELECT count(*) FROM voice_policies")).scalar() == 0


def test_the_saved_policy_drives_the_route(make_account, monkeypatch):
    from app.routers import languages as api

    monkeypatch.setattr(api, "configured_providers", lambda: frozenset({"browser-stt", "anthropic", "kokoro"}))
    a = make_account("a@example.com")
    everywhere = ["device", "uk", "eu", "us", "global"]
    a.put(
        a.o("/voice/policy"),
        json={
            **POLICY,
            "allowed_regions": everywhere,
            "allow_paid": True,
            "blocked_providers": [],
            "preferred_providers": [],
        },
    )
    r = a.get(a.o("/voice/route"), params={"language": "ar-SA"}).json()
    # Arabic is not one of the workspace's languages: the saved fallback is used, and says so.
    assert r["routable"] and r["language"] == "en-GB" and r["language_fallback"] is True
    # Saving a stricter policy changes the route: no paid model may be used now.
    a.put(
        a.o("/voice/policy"),
        json={
            **POLICY,
            "allowed_regions": everywhere,
            "allow_paid": False,
            "blocked_providers": [],
            "preferred_providers": [],
        },
    )
    r = a.get(a.o("/voice/route"), params={"language": "en-GB"}).json()
    assert r["routable"] is False and "paid" in r["gaps"]["llm"]
    assert a.get(a.o("/voice/route"), params={"language": "zz-ZZ"}).status_code == 422


# ---- phone numbers -------------------------------------------------------------------------------


def test_a_workspace_lists_only_its_own_numbers(make_account, owner_engine):
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    assign_number(owner_engine, a.org_id, "+441179460000")
    assign_number(owner_engine, b.org_id, "+441179460001")
    assert [n["e164"] for n in a.get(a.o("/voice/numbers")).json()] == ["+441179460000"]
    assert [n["e164"] for n in b.get(b.o("/voice/numbers")).json()] == ["+441179460001"]


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO phone_numbers (id, organization_id, e164, status) VALUES (gen_random_uuid(), :o, '+441179460009', 'active')",
        "UPDATE phone_numbers SET status = 'active'",
        "DELETE FROM phone_numbers",
    ],
)
def test_the_runtime_role_can_never_assign_or_change_a_number(make_account, app_engine, sql):
    a = make_account("a@example.com")
    with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": a.org_id})
        c.execute(text(sql), {"o": a.org_id})


def test_a_number_belongs_to_one_workspace_only(make_account, owner_engine):
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    assign_number(owner_engine, a.org_id)
    with pytest.raises(Exception, match="uq_phone_number_e164"):
        assign_number(owner_engine, b.org_id)
    with pytest.raises(Exception, match="ck_phone_number_e164"):
        assign_number(owner_engine, a.org_id, "07700900123")  # not E.164


def test_numbers_and_policy_go_with_the_workspace(make_account, owner_engine):
    a = make_account("a@example.com")
    a.put(a.o("/voice/policy"), json=POLICY)
    assign_number(owner_engine, a.org_id)
    export = a.get(a.o("/export")).json()
    assert export["voice_policy"][0]["languages"] == ["en-GB", "hi-IN"]
    assert export["phone_numbers"][0]["e164"] == "+441179460000"
    with owner_engine.begin() as c:
        c.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": a.org_id})
        assert c.execute(text("SELECT count(*) FROM phone_numbers")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM voice_policies")).scalar() == 0


# ---- the dialled number gates telephone call records ---------------------------------------------


def test_a_phone_call_is_recorded_only_for_the_workspaces_own_active_number(
    worker,  # noqa: F811
    make_account,
    monkeypatch,
    owner_engine,  # noqa: F811
):
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    _launch_ready(monkeypatch, a)
    mine = assign_number(owner_engine, a.org_id, "+441179460000")
    theirs = assign_number(owner_engine, b.org_id, "+441179460001")
    off = assign_number(owner_engine, a.org_id, "+441179460002", status="disabled")
    phone = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone")

    refusals = [
        _start(a.client, phone),  # no dialled number
        _start(a.client, phone, called_number=theirs),  # another workspace's number
        _start(a.client, phone, called_number=off),  # disabled
        _start(a.client, phone, called_number="+441179469999"),  # nobody's
    ]
    assert {r.status_code for r in refusals} == {403}
    # The same answer for "someone else's" and "nobody's": nothing reveals who owns a number.
    assert len({r.json()["detail"] for r in refusals}) == 1
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM calls")).scalar() == 0

    r = _start(a.client, phone, called_number=mine)
    assert r.status_code == 201 and r.json()["channel"] == "phone"


def test_a_simulated_call_has_no_dialled_number(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    assert _start(a.client, token, called_number="+441179460000").status_code == 422


def test_the_worker_reads_its_workspaces_saved_policy(worker, make_account):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    a.put(a.o("/voice/policy"), json=POLICY)
    r = a.client.get("/v1/worker/voice/policy", headers=_h(worker_auth.mint(uuid.UUID(a.org_id))))
    assert r.status_code == 200 and r.json()["languages"] == ["en-GB", "hi-IN"]
    r = b.client.get("/v1/worker/voice/policy", headers=_h(worker_auth.mint(uuid.UUID(b.org_id))))
    assert r.json()["saved"] is False  # the workspace comes from the token, never the request


def test_worker_policy_route_does_not_exist_until_enabled(client):
    assert client.get("/v1/worker/voice/policy").status_code == 404


# ---- the operator script -------------------------------------------------------------------------


def _run(owner_engine, monkeypatch, *argv, claimed="staging"):
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import phone_numbers

    monkeypatch.setattr(phone_numbers.deploy_env, "claimed", lambda conn: claimed)
    a = phone_numbers.parser().parse_args(["--env", "staging", *argv])
    with Session(owner_engine) as db:
        return phone_numbers.run(db, "staging", a), phone_numbers


def test_operator_assigns_disables_and_resolves_numbers(make_account, owner_engine, monkeypatch):
    a, b = make_account("a@example.com"), make_account("b@example.com", "Other")
    out, mod = _run(owner_engine, monkeypatch, "assign", "--org", a.org_id, "--number", "+44 117 946 0000")
    assert out == {"e164": "+441179460000", "org": a.org_id, "status": "active"}
    with pytest.raises(mod.Refused, match="already assigned"):
        _run(owner_engine, monkeypatch, "assign", "--org", b.org_id, "--number", "+441179460000")
    assert _run(owner_engine, monkeypatch, "disable", "--number", "+441179460000")[0]["status"] == "disabled"
    assert _run(owner_engine, monkeypatch, "resolve", "--number", "+441179460000")[0]["org"] == a.org_id
    assert [x["action"] for x in a.get(a.o("/audit-logs")).json() if x["action"].startswith("phone_number")] == [
        "phone_number.disabled",
        "phone_number.assigned",
    ]


def test_operator_script_refuses_the_wrong_environment(make_account, owner_engine, monkeypatch):
    a = make_account("a@example.com")
    with pytest.raises(Exception, match="claimed for 'production'"):
        _run(owner_engine, monkeypatch, "assign", "--org", a.org_id, "--number", "+441179460000", claimed="production")
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM phone_numbers")).scalar() == 0


def test_operator_script_rejects_numbers_that_are_not_e164():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import phone_numbers

    with pytest.raises(argparse.ArgumentTypeError):
        phone_numbers._number("07700900123")
