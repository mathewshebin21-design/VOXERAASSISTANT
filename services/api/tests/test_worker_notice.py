"""Phone notice playout acknowledgement is ordered, bound to one call and fail-closed.

All phone acceptance here uses synthetic launch signoffs; it does NOT approve
any real carrier, speech model, region, recording policy or paid inference.
"""

import uuid

from sqlalchemy import text

from app import worker_auth
from app.voice import launch

from .test_worker_auth import worker  # noqa: F401 (fixture)
from .test_worker_calls import TURN, _h, _start, assign_number


def phone_setup(worker, make_account, monkeypatch, owner_engine):  # noqa: F811
    account = make_account(f"notice-{uuid.uuid4().hex[:10]}@example.com")
    account.patch(account.o("/settings"), json={"locale": "en-GB"})
    monkeypatch.setitem(
        launch.SIGN_OFFS,
        "GB",
        tuple(launch.SignOff(key, "offline-test", "2026-12-01", f"test://{key}") for key in launch.CHECKS),
    )
    number = assign_number(owner_engine, account.org_id)
    ref = "room-notice-" + uuid.uuid4().hex[:12]
    token = worker_auth.mint(uuid.UUID(account.org_id), mode="live", channel="phone", call_ref=ref)
    return account, token, ref, number


def ack(account, token, call_id, notice):
    return account.client.post(
        f"/v1/worker/calls/{call_id}/notice-playback",
        json={"notice": notice, "method": "livekit_speech_playout"},
        headers=_h(token),
    )


def test_phone_notice_receipts_are_ordered_idempotent_and_prior_text_remains_withheld(
    worker, make_account, monkeypatch, owner_engine  # noqa: F811
):
    a, token, ref, number = phone_setup(worker, make_account, monkeypatch, owner_engine)
    # Caller-supplied flags, even with a correctly signed token, cannot skip playback.
    for f in ("ai_disclosure_played", "recording_notice_played"):
        assert _start(a.client, token, external_ref=ref, called_number=number, **{f: True}).status_code == 403

    call = _start(a.client, token, external_ref=ref, called_number=number)
    assert call.status_code == 201
    cid = call.json()["id"]
    assert call.json()["ai_disclosure_played"] is False
    assert call.json()["recording_notice_played"] is False
    assert call.json()["transcript_retained"] is False

    assert a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token)).status_code == 201
    assert ack(a, token, cid, "recording_notice").status_code == 409
    ai = ack(a, token, cid, "ai_disclosure")
    assert ai.status_code == 200 and ai.json()["ai_disclosure_played"] is True
    assert ai.json()["recording_notice_played"] is False
    assert ai.json()["transcript_retained"] is False

    assert a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token)).status_code == 201
    assert ack(a, token, cid, "ai_disclosure").status_code == 200
    record = ack(a, token, cid, "recording_notice")
    assert record.status_code == 200 and record.json()["recording_notice_played"] is True
    assert record.json()["transcript_retained"] is True
    assert ack(a, token, cid, "recording_notice").status_code == 200

    assert a.client.post(f"/v1/worker/calls/{cid}/events", json={"events": TURN}, headers=_h(token)).status_code == 201
    events = a.get(a.o(f"/calls/{cid}")).json()["events"]
    said = [event["text"] for event in events if event["kind"] == "utterance"]
    assert said == [None, None, None, None, TURN[0]["text"], TURN[1]["text"]]
    notices = [event["data"] for event in events if event["data"].get("event") == "notice_playout_reported"]
    assert notices == [
        {"event": "notice_playout_reported", "notice": "ai_disclosure", "method": "livekit_speech_playout"},
        {"event": "notice_playout_reported", "notice": "recording_notice", "method": "livekit_speech_playout"},
    ]
    assert a.client.post(f"/v1/worker/calls/{cid}/end", json={}, headers=_h(token)).status_code == 200
    assert ack(a, token, cid, "ai_disclosure").status_code == 409
    with owner_engine.connect() as db:
        assert db.execute(
            text("SELECT count(*) FROM call_events WHERE call_id = :id AND kind = 'system'"),
            {"id": cid},
        ).scalar_one() == 2


def test_notice_receipt_rejects_another_session_workspace_or_non_phone_channel(
    worker, make_account, monkeypatch, owner_engine  # noqa: F811
):
    a, phone, ref, number = phone_setup(worker, make_account, monkeypatch, owner_engine)
    a_call = _start(a.client, phone, external_ref=ref, called_number=number).json()["id"]
    other_room = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref="room-different-001")
    b = make_account("notice-other-tenant@example.com")
    b_token = worker_auth.mint(uuid.UUID(b.org_id), mode="live", channel="phone", call_ref=ref)
    simulated = worker_auth.mint(uuid.UUID(a.org_id), call_ref=ref)
    assert ack(a, other_room, a_call, "ai_disclosure").status_code == 404
    assert ack(b, b_token, a_call, "ai_disclosure").status_code == 404
    assert ack(a, simulated, a_call, "ai_disclosure").status_code == 403
    assert a.client.post(
        f"/v1/worker/calls/{a_call}/notice-playback",
        json={"notice": "ai_disclosure", "method": "from_client_only"},
        headers=_h(phone),
    ).status_code == 422
    assert a.client.post(
        f"/v1/worker/calls/{a_call}/notice-playback",
        json={"notice": "ai_disclosure", "method": "livekit_speech_playout", "completed": False},
        headers=_h(phone),
    ).status_code == 422
    assert ack(a, phone, str(uuid.uuid4()), "ai_disclosure").status_code == 404
    assert a.get(a.o(f"/calls/{a_call}")).json()["ai_disclosure_played"] is False
