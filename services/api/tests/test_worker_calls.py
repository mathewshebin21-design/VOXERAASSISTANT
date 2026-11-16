"""The voice worker records its own calls (/v1/worker/calls) with a scoped worker token.

The workspace and the channel come from the token: a test token only ever records a simulated call,
a worker never writes to a member's test call, and live mode stays behind the launch gate.
"""

import uuid

import pytest
from sqlalchemy import text

from app import worker_auth

from .test_worker_auth import worker  # noqa: F401  (fixture)


def _h(token: str) -> dict:
    return {"authorization": f"Bearer {token}"}


def _start(client, token, **body):
    return client.post("/v1/worker/calls", json=body, headers=_h(token))


def assign_number(owner_engine, org_id: str, e164: str = "+441179460000", status: str = "active") -> str:
    """What scripts/phone_numbers.py does (as the owner): the API itself can never assign a number."""
    with owner_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO phone_numbers (id, organization_id, e164, status) VALUES (gen_random_uuid(), :o, :n, :s)"
            ),
            {"o": org_id, "n": e164, "s": status},
        )
    return e164


TURN = [
    {"kind": "utterance", "speaker": "caller", "text": "Are you open on Saturday?", "data": {"language": "en-GB"}},
    {"kind": "tool", "speaker": "agent", "data": {"name": "get_opening_hours", "ok": True}},
    {"kind": "utterance", "speaker": "agent", "text": "Yes, from nine until one.", "data": {"first_text_ms": 420}},
]


def test_worker_call_routes_do_not_exist_until_enabled(client):
    assert client.post("/v1/worker/calls", json={}).status_code == 404


def test_worker_records_a_whole_call_for_its_own_workspace(worker, make_account):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    r = _start(a.client, token, external_ref="room-abc12345", ai_disclosure_played=True, recording_notice_played=True)
    assert r.status_code == 201
    call = r.json()
    assert call["channel"] == "simulated" and call["status"] == "in_progress"
    cid = call["id"]
    assert a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token)).status_code == 201
    r = a.client.post(f"/v1/worker/calls/{cid}/end", json={"outcome": "answered"}, headers=_h(token))
    assert r.status_code == 200 and r.json()["status"] == "completed"

    # The owner reads it like any other call; the other workspace cannot see it.
    detail = a.get(a.o(f"/calls/{cid}")).json()
    assert [e["seq"] for e in detail["events"]] == [1, 2, 3]
    assert detail["events"][0]["text"] == "Are you open on Saturday?"
    assert detail["summary"]["caller_turns"] == 1 and detail["summary"]["tools"] == {"get_opening_hours": 1}
    assert b.get(b.o(f"/calls/{cid}")).status_code == 404
    # Audited as the worker, never with transcript text.
    logs = a.get(a.o("/audit-logs")).json()
    worker_rows = [x for x in logs if x["action"] in ("call.started", "call.ended")]
    assert worker_rows and all(x["details"].get("by") == "worker" for x in worker_rows)
    assert "Saturday" not in str(logs)


def test_restarting_worker_continues_the_same_call(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    first = _start(a.client, token, external_ref="room-restart01")
    again = _start(a.client, token, external_ref="room-restart01")
    assert first.status_code == 201 and again.status_code == 200 and again.json()["id"] == first.json()["id"]


def test_ended_worker_room_cannot_be_reopened_by_replaying_its_signed_reference(worker, make_account):  # noqa: F811
    a = make_account("ended-room@example.com")
    ref = "room-ended-replay01"
    token = worker_auth.mint(uuid.UUID(a.org_id), call_ref=ref)
    first = _start(a.client, token, external_ref=ref)
    assert first.status_code == 201
    assert (
        a.client.post(
            f"/v1/worker/calls/{first.json()['id']}/end",
            json={"status": "completed"},
            headers=_h(token),
        ).status_code
        == 200
    )
    assert _start(a.client, token, external_ref=ref).status_code == 409


def test_without_the_recording_notice_the_words_are_not_kept(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    cid = _start(a.client, token).json()["id"]
    a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token))
    evs = a.get(a.o(f"/calls/{cid}")).json()["events"]
    assert all(e["text"] is None for e in evs)
    assert [e["data"].get("text_withheld") for e in evs if e["kind"] == "utterance"] == [True, True]


def test_channel_comes_from_the_token_not_the_request(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    r = _start(a.client, token, channel="phone")  # not a field: a worker cannot choose its channel
    assert r.status_code == 422
    r = a.post(a.o("/calls"), json={"channel": "phone"})  # nor can a member record phone calls
    assert r.status_code == 422


def test_a_worker_cannot_touch_a_members_test_call(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    member_call = a.post(a.o("/calls"), json={"external_ref": "member-call-01"}).json()["id"]
    token = worker_auth.mint(uuid.UUID(a.org_id))
    r = a.client.post(f"/v1/worker/calls/{member_call}/events", json={"events": TURN}, headers=_h(token))
    assert r.status_code == 404
    assert a.client.post(f"/v1/worker/calls/{member_call}/end", json={}, headers=_h(token)).status_code == 404
    # Reusing a member's reference does not hand the worker that call either.
    assert _start(a.client, token, external_ref="member-call-01").status_code == 409


def test_member_and_worker_tokens_are_not_interchangeable(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    assert _start(a.client, a.tokens["access_token"]).status_code == 401
    assert a.client.post("/v1/worker/calls", json={}).status_code == 401
    wt = worker_auth.mint(uuid.UUID(a.org_id))
    r = a.client.post(a.o("/calls"), json={}, headers=_h(wt))
    assert r.status_code == 401


def test_a_worker_cannot_reach_another_workspaces_call(worker, make_account):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com")
    cid = _start(a.client, worker_auth.mint(uuid.UUID(a.org_id))).json()["id"]
    tb = worker_auth.mint(uuid.UUID(b.org_id))
    assert b.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(tb)).status_code == 404
    assert b.client.post(f"/v1/worker/calls/{cid}/end", json={}, headers=_h(tb)).status_code == 404


def test_an_ended_call_takes_no_more_events(worker, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id))
    cid = _start(a.client, token).json()["id"]
    a.client.post(
        f"/v1/worker/calls/{cid}/end", json={"status": "failed", "reason": "brain unavailable"}, headers=_h(token)
    )
    r = a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token))
    assert r.status_code == 409
    assert a.client.post(f"/v1/worker/calls/{cid}/end", json={}, headers=_h(token)).status_code == 409


def test_live_and_phone_call_records_stay_behind_the_launch_gate(worker, make_account, monkeypatch, owner_engine):  # noqa: F811
    from app.voice import launch

    a = make_account("a@example.com")
    phone = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref="room-phone-001")
    assert _start(a.client, phone).status_code == 403
    live_sim = worker_auth.mint(uuid.UUID(a.org_id), mode="live")
    assert _start(a.client, live_sim).status_code == 403
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM calls")).scalar() == 0
    # Once the business's country passes every launch check, a live phone call is recorded as phone.
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    number = assign_number(owner_engine, a.org_id)
    r = _start(
        a.client,
        phone,
        external_ref="room-phone-001",
        called_number=number,
        caller_number="+44 20 7946 0000",
    )
    assert r.status_code == 201 and r.json()["channel"] == "phone"
    assert r.json()["recording_notice_played"] is False and r.json()["transcript_retained"] is False


def test_scoped_simulated_token_refuses_other_calls_in_the_same_tenant(worker, make_account):  # noqa: F811
    a = make_account("bound-simulation@example.com")
    one_ref, two_ref = "room-bound-test-01", "room-bound-test-02"
    one = worker_auth.mint(uuid.UUID(a.org_id), call_ref=one_ref)
    two = worker_auth.mint(uuid.UUID(a.org_id), call_ref=two_ref)
    assert _start(a.client, one, external_ref=two_ref).status_code == 403
    first = _start(a.client, one, external_ref=one_ref)
    second = _start(a.client, two, external_ref=two_ref)
    assert first.status_code == second.status_code == 201
    second_id = second.json()["id"]
    assert (
        a.client.post(f"/v1/worker/calls/{second_id}/events", json={"events": TURN}, headers=_h(one)).status_code == 404
    )
    assert a.client.post(f"/v1/worker/calls/{second_id}/end", json={}, headers=_h(one)).status_code == 404
    assert (
        a.client.post(f"/v1/worker/calls/{second_id}/events", json={"events": TURN}, headers=_h(two)).status_code == 201
    )


def test_phone_worker_token_is_bound_to_only_one_signed_call(worker, make_account, monkeypatch, owner_engine):  # noqa: F811
    from app.voice import launch

    a = make_account("bound-phone@example.com")
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    number = assign_number(owner_engine, a.org_id)
    a_ref, b_ref = "room-bound-phone-a", "room-bound-phone-b"
    token_a = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref=a_ref)
    token_b = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref=b_ref)
    assert _start(a.client, token_a, external_ref=b_ref, called_number=number).status_code == 403
    assert _start(a.client, token_a, called_number=number).status_code == 403
    first = _start(a.client, token_a, external_ref=a_ref, called_number=number)
    second = _start(a.client, token_b, external_ref=b_ref, called_number=number)
    assert first.status_code == second.status_code == 201
    b_id = second.json()["id"]
    assert (
        a.client.post(f"/v1/worker/calls/{b_id}/events", json={"events": TURN}, headers=_h(token_a)).status_code == 404
    )
    assert a.client.post(f"/v1/worker/calls/{b_id}/end", json={}, headers=_h(token_a)).status_code == 404
    assert (
        a.client.post(f"/v1/worker/calls/{b_id}/events", json={"events": TURN}, headers=_h(token_b)).status_code == 201
    )


@pytest.mark.parametrize("mode,channel", [("test", "simulated"), ("live", "phone")])
def test_a_test_token_never_produces_a_phone_record(worker, make_account, monkeypatch, owner_engine, mode, channel):  # noqa: F811
    from app.voice import launch

    a = make_account("a@example.com")
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    body = (
        {"called_number": assign_number(owner_engine, a.org_id), "external_ref": "room-phone-002"}
        if channel == "phone"
        else {}
    )
    token = worker_auth.mint(
        uuid.UUID(a.org_id), mode=mode, channel=channel, call_ref="room-phone-002" if channel == "phone" else None
    )
    r = _start(a.client, token, **body)
    assert r.status_code == 201 and r.json()["channel"] == ("phone" if mode == "live" else "simulated")
