"""Persistent simulated-worker fallback: staff queue receipt, isolation and idempotency.

The live telephone path is deliberately excluded until call-bound credentials,
verified disclosures and separate release authorization are in place.
"""

import uuid

from sqlalchemy import text

from app import worker_auth

from .test_worker_auth import worker  # noqa: F401 (fixture)


def _auth(token: str) -> dict:
    return {"authorization": f"Bearer {token}"}


def _start(client, token: str, *, notice: bool = True) -> str:
    r = client.post(
        "/v1/worker/calls",
        json={"ai_disclosure_played": notice, "recording_notice_played": notice},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return r.json()["id"]


BODY = {"caller_name": "Sam Patel", "caller_phone": "07700 900123", "message": "About my booking"}


def _save(client, token: str, call_id: str, **fields):
    return client.post(
        f"/v1/worker/calls/{call_id}/fallback-message",
        json={**BODY, **fields},
        headers=_auth(token),
    )


def test_simulated_worker_fallback_is_durable_idempotent_and_visible_to_staff(worker, make_account, owner_engine):  # noqa: F811
    account = make_account("fallback-saved@example.com")
    token = worker_auth.mint(uuid.UUID(account.org_id), mode="test", channel="simulated")
    call_id = _start(account.client, token)
    saved = _save(account.client, token, call_id)
    assert saved.status_code == 201
    receipt = saved.json()
    assert receipt["saved"] is True and receipt["destination"] == "staff_queue"

    case = account.get(account.o(f"/cases/{receipt['case_id']}"))
    assert case.status_code == 200
    assert case.json()["summary"] == BODY["message"]
    assert case.json()["caller_name"] == BODY["caller_name"]
    assert case.json()["status"] == "new"

    replay = _save(account.client, token, call_id)
    assert replay.status_code == 200 and replay.json() == receipt
    assert _save(account.client, token, call_id, message="Changed message").status_code == 409

    events = account.get(account.o(f"/calls/{call_id}")).json()["events"]
    receipts = [e for e in events if e["kind"] == "system" and e["data"].get("event") == "fallback_case_persisted"]
    assert len(receipts) == 1 and receipts[0]["data"]["case_id"] == receipt["case_id"]
    assert BODY["message"] not in str(receipts)

    ended = account.client.post(
        f"/v1/worker/calls/{call_id}/end",
        json={"status": "completed", "outcome": "message_taken"},
        headers=_auth(token),
    )
    assert ended.status_code == 200
    assert _save(account.client, token, call_id).status_code == 200  # lost-response retry after call end
    with owner_engine.connect() as conn:
        assert conn.execute(
            text("SELECT count(*) FROM caller_messages WHERE organization_id = :org"),
            {"org": account.org_id},
        ).scalar_one() == 1


def test_fallback_rejects_missing_notices_bad_contact_and_ended_call(worker, make_account, owner_engine):  # noqa: F811
    account = make_account("fallback-rejected@example.com")
    token = worker_auth.mint(uuid.UUID(account.org_id), mode="test")
    call_id = _start(account.client, token, notice=False)
    assert _save(account.client, token, call_id).status_code == 403
    assert _save(account.client, token, call_id, caller_phone="bad").status_code == 422
    assert _save(account.client, token, call_id, message=" ").status_code == 422
    assert account.client.post(
        f"/v1/worker/calls/{call_id}/end", json={"status": "failed"}, headers=_auth(token)
    ).status_code == 200
    assert _save(account.client, token, call_id).status_code == 403  # still cannot pass missing notice
    with owner_engine.connect() as conn:
        assert conn.execute(
            text("SELECT count(*) FROM caller_messages WHERE organization_id = :org"),
            {"org": account.org_id},
        ).scalar_one() == 0

    live_call_id = _start(account.client, token, notice=True)
    assert account.client.post(
        f"/v1/worker/calls/{live_call_id}/end", json={"status": "failed"}, headers=_auth(token)
    ).status_code == 200
    assert _save(account.client, token, live_call_id).status_code == 409


def test_fallback_cannot_cross_tenants_or_use_member_calls(worker, make_account, owner_engine):  # noqa: F811
    a = make_account("fallback-a@example.com")
    b = make_account("fallback-b@example.com")
    a_token = worker_auth.mint(uuid.UUID(a.org_id))
    b_token = worker_auth.mint(uuid.UUID(b.org_id))
    a_call = _start(a.client, a_token)
    assert _save(b.client, b_token, a_call).status_code == 404
    assert _save(a.client, a.tokens["access_token"], a_call).status_code == 401
    member = a.post(a.o("/calls"), json={"channel": "simulated", "recording_notice_played": True}).json()
    assert _save(a.client, a_token, member["id"]).status_code == 404
    assert _save(a.client, a_token, str(uuid.uuid4())).status_code == 404
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM caller_messages")).scalar_one() == 0


def test_fallback_live_phone_token_still_refused_before_any_write(worker, make_account):  # noqa: F811
    a = make_account("fallback-phone@example.com")
    phone = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone")
    assert _save(a.client, phone, str(uuid.uuid4())).status_code == 403
