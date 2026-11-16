"""Scoped voice-worker credentials and the worker brain endpoint (ADR-0005 §3)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic import SecretStr

from app import worker_auth
from app.config import get_settings

from .test_live import (
    events,
    live,  # noqa: F401  (fixture)
    message,
    setup_business,
)

SECRET = "worker-secret-for-tests-worker-secret-123"


@pytest.fixture
def worker(monkeypatch):
    monkeypatch.setattr(get_settings(), "worker_secret", SecretStr(SECRET))


def body(text="Hi, are you open today?", rid="w-test-000001"):
    return {"request_id": rid, "messages": [{"role": "user", "text": text}]}


def approve_mock_llm_for_test(monkeypatch, account):
    """Synthetic model attestation, injected only by pytest (never production code)."""
    from app.voice import worker_llm_policy

    settings = get_settings()
    assert settings.llm_provider == "anthropic"
    attestation = worker_llm_policy.ReviewedLLM(
        configured_provider="anthropic",
        model=settings.model,
        workspace_provider="anthropic",
        processing_regions=frozenset({"global"}),
        paid=True,
        languages=frozenset({"en-GB"}),
        evidence="tested",
    )
    monkeypatch.setattr(
        worker_llm_policy,
        "REVIEWED_MODELS",
        {("anthropic", settings.model): attestation},
    )
    result = account.put(
        account.o("/voice/policy"),
        json={
            "default_language": "en-GB",
            "languages": ["en-GB"],
            "fallback_language": "en-GB",
            "allowed_regions": ["global"],
            "blocked_providers": [],
            "preferred_providers": [],
            "allow_paid": True,
            "allow_unverified": False,
        },
    )
    assert result.status_code == 200


def test_worker_test_token_cannot_bypass_unapproved_model(worker, live, make_account):  # noqa: F811
    a = make_account("unapproved@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="test")
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "not approved" in r.json()["detail"]
    assert live["llm_requests"] == []


def test_endpoint_does_not_exist_until_enabled(client):
    assert client.post("/v1/worker/live/brain", json=body()).status_code == 404


def test_tokens_are_scoped_short_lived_and_signed_separately(worker):
    org = uuid.uuid4()
    assert worker_auth.verify(worker_auth.mint(org)) == (org, "test")
    with pytest.raises(worker_auth.WorkerAuthError):
        worker_auth.mint(org, ttl=timedelta(hours=1))
    expired = worker_auth.mint(org, now=datetime.now(UTC) - timedelta(minutes=20))
    with pytest.raises(worker_auth.WorkerAuthError, match="expired"):
        worker_auth.verify(expired)
    now = int(datetime.now(UTC).timestamp())
    base = {
        "iss": "voxera-api",
        "aud": "voxera-worker-brain",
        "org": str(org),
        "iat": now,
        "exp": now + 60,
        "mode": "test",
    }
    for bad in (
        {**base, "scope": "admin"},
        {**base, "scope": "live:brain", "aud": "voxera-app"},
        {**base, "scope": "live:brain", "exp": now + 3600},
    ):
        with pytest.raises(worker_auth.WorkerAuthError):
            worker_auth.verify(jwt.encode(bad, SECRET, algorithm="HS256"))
    # Signed with the user-session secret: refused.
    forged = jwt.encode({**base, "scope": "live:brain"}, get_settings().jwt_secret.get_secret_value(), "HS256")
    with pytest.raises(worker_auth.WorkerAuthError):
        worker_auth.verify(forged)


def test_worker_token_drives_the_brain_for_its_workspace_only(worker, live, make_account, owner_engine, monkeypatch):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com")
    setup_business(a)
    approve_mock_llm_for_test(monkeypatch, a)
    live["llm"] = [(200, message([("text", {"parts": ["We're open until six."]})], "end_turn", 40, 6))]
    token = worker_auth.mint(uuid.UUID(a.org_id))
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 200 and events(r)[-1]["type"] == "done"
    sent = live["llm_requests"][0].content.decode()
    assert "Halden & Rye" in sent  # A's business data, from the token's workspace
    # Usage is metered against A's workspace, and nothing against B's.
    from sqlalchemy import text

    with owner_engine.connect() as c:
        rows = dict(c.execute(text("SELECT organization_id::text, count(*) FROM usage_events GROUP BY 1")).all())
    assert rows.get(a.org_id) == 1 and b.org_id not in rows


def test_policy_revocation_blocks_the_next_worker_turn_before_spend(worker, live, make_account, monkeypatch):  # noqa: F811
    a = make_account("revoked-policy@example.com")
    approve_mock_llm_for_test(monkeypatch, a)
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="test")
    auth = {"authorization": f"Bearer {token}"}

    live["llm"] = [(200, message([("text", {"parts": ["Hello."]})], "end_turn", 8, 2))]
    first = a.client.post("/v1/worker/live/brain", json=body(rid="w-revocation-0001"), headers=auth)
    assert first.status_code == 200 and len(live["llm_requests"]) == 1

    policy = a.get(a.o("/voice/policy")).json()
    assert policy.pop("saved") is True
    policy["blocked_providers"] = ["anthropic"]
    assert a.put(a.o("/voice/policy"), json=policy).status_code == 200

    next_turn = a.client.post("/v1/worker/live/brain", json=body(rid="w-revocation-0002"), headers=auth)
    assert next_turn.status_code == 403
    assert len(live["llm_requests"]) == 1  # no second provider request after revocation


def test_user_and_worker_tokens_cannot_be_swapped(worker, make_account):
    a = make_account("a@example.com")
    user_token = a.tokens["access_token"]
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {user_token}"})
    assert r.status_code == 401
    wt = worker_auth.mint(uuid.UUID(a.org_id))
    r = a.client.post(a.o("/live/brain"), json=body(), headers={"authorization": f"Bearer {wt}"})
    assert r.status_code == 401
    assert a.client.post("/v1/worker/live/brain", json=body()).status_code == 401


def test_a_token_for_a_deleted_or_unknown_workspace_is_refused(worker, live):  # noqa: F811
    from fastapi.testclient import TestClient

    from app.main import app

    token = worker_auth.mint(uuid.uuid4())
    with TestClient(app) as c:
        r = c.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 404 and live["llm_requests"] == []


def test_worker_secret_must_be_strong():
    from app.config import Settings

    with pytest.raises(ValueError):
        Settings(worker_secret="short")


def test_live_mode_is_refused_until_the_country_passes_its_launch_review(worker, live, make_account, monkeypatch):  # noqa: F811
    from app.voice import launch

    a = make_account("a@example.com")
    setup_business(a)
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="live")
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 403 and live["llm_requests"] == []
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    approve_mock_llm_for_test(monkeypatch, a)
    live["llm"] = [(200, message([("text", {"parts": ["Hello."]})], "end_turn", 10, 2))]
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 200
    with pytest.raises(worker_auth.WorkerAuthError):
        worker_auth.mint(uuid.UUID(a.org_id), mode="production")


def test_scoped_worker_brain_rejects_cross_call_and_record_injection_before_spend(
    worker,
    live,  # noqa: F811
    make_account,
    monkeypatch,
):
    a = make_account("bound-brain@example.com")
    approve_mock_llm_for_test(monkeypatch, a)
    ref = "room-bound-brain-001"
    token = worker_auth.mint(uuid.UUID(a.org_id), call_ref=ref)
    h = {"authorization": f"Bearer {token}"}
    wrong = {**body(rid="w-other-call-0001"), "conversation_id": "room-bound-brain-002"}
    assert a.client.post("/v1/worker/live/brain", json=wrong, headers=h).status_code == 403
    injection = {**body(rid="w-recording-0001"), "conversation_id": ref, "call_id": str(uuid.uuid4())}
    assert a.client.post("/v1/worker/live/brain", json=injection, headers=h).status_code == 422
    assert live["llm_requests"] == []
    live["llm"] = [(200, message([("text", {"parts": ["Hello."]})], "end_turn", 8, 2))]
    correct = {**body(rid="w-correct-call-0001"), "conversation_id": ref}
    r = a.client.post("/v1/worker/live/brain", json=correct, headers=h)
    assert r.status_code == 200 and events(r)[-1]["type"] == "done"
    assert len(live["llm_requests"]) == 1


def test_phone_prompt_never_claims_a_connected_human():
    from app.live.receptionist import BusinessContext, system_prompt

    ctx = BusinessContext(name="Review Clinic", greeting="Hello", disclosure=None)
    phone_prompt = system_prompt(ctx, can_transfer=False)
    member_prompt = system_prompt(ctx)
    assert "Telephone transfers are not connected" in phone_prompt
    assert "transfer_to_staff" not in phone_prompt
    assert "guaranteed a callback" in phone_prompt
    assert "transfer_to_staff" in member_prompt


def test_phone_worker_never_offers_or_executes_a_phantom_carrier_transfer(
    worker,
    live,  # noqa: F811
    make_account,
    monkeypatch,
    owner_engine,
):
    from sqlalchemy import text

    from app.voice import launch

    from .test_worker_calls import assign_number

    a = make_account("phone-handoff-blocked@example.com")
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    approve_mock_llm_for_test(monkeypatch, a)

    ref = "room-phone-handoff001"
    phone = assign_number(owner_engine, a.org_id)
    jwt_token = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref=ref)
    auth = {"authorization": f"Bearer {jwt_token}"}
    start = a.client.post(
        "/v1/worker/calls",
        json={"external_ref": ref, "called_number": phone},
        headers=auth,
    )
    assert start.status_code == 201
    for notice in ("ai_disclosure", "recording_notice"):
        r = a.client.post(
            f"/v1/worker/calls/{start.json()['id']}/notice-playback",
            json={"notice": notice, "method": "livekit_speech_playout"},
            headers=auth,
        )
        assert r.status_code == 200

    # Exercise the SECOND server-side guard even if the schema validator were
    # accidentally loosened. The phone transfer must still never be executed.
    from app.live import toolcheck

    original_check = toolcheck.validate_call

    def relaxed_for_test(by_name, name, args):
        if name == "transfer_to_staff":
            return args
        return original_check(by_name, name, args)

    monkeypatch.setattr(toolcheck, "validate_call", relaxed_for_test)
    # The fake provider maliciously returns a tool that was NOT offered.
    # The deeper routing guard refuses it without writing a case or handoff.
    live["llm"] = [
        (
            200,
            message(
                [
                    (
                        "tool",
                        {
                            "id": "toolu_phantom",
                            "name": "transfer_to_staff",
                            "json": '{"reason":"staff","summary":"urgent","caller_name":"Sam",'
                            '"caller_phone":"07700900123","urgent":false}',
                        },
                    )
                ],
                "tool_use",
                30,
                6,
            ),
        ),
        (200, message([("text", {"parts": ["I can save a message for the team."]})], "end_turn", 30, 8)),
    ]
    r = a.client.post(
        "/v1/worker/live/brain",
        json={
            "request_id": "w-no-transfer-001",
            "conversation_id": ref,
            "messages": [{"role": "user", "text": "Can you put me through to staff?"}],
        },
        headers=auth,
    )
    assert r.status_code == 200
    es = events(r)
    assert any(e.get("type") == "tool" and e.get("ok") is False for e in es)
    assert not any(e.get("type") == "handoff" for e in es)
    assert es[-1]["type"] == "done"
    first = json.loads(live["llm_requests"][0].content)
    assert "transfer_to_staff" not in {t["name"] for t in first["tools"]}
    assert "take_message" in {t["name"] for t in first["tools"]}
    assert "Telephone transfers are not connected" in str(first["system"])
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM caller_messages")).scalar_one() == 0


def test_phone_model_spend_refuses_missing_or_partial_notice_playout(
    worker,
    live,  # noqa: F811
    make_account,
    monkeypatch,
    owner_engine,
):
    from app.voice import launch

    from .test_worker_calls import assign_number

    a = make_account("phone-notices-before-brain@example.com")
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    monkeypatch.setitem(
        launch.SIGN_OFFS,
        "GB",
        tuple(launch.SignOff(c, "offline-test", "2026-12-01", f"test://{c}") for c in launch.CHECKS),
    )
    approve_mock_llm_for_test(monkeypatch, a)
    ref = "room-phone-notices-001"
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref=ref)
    h = {"authorization": f"Bearer {token}"}
    started = a.client.post(
        "/v1/worker/calls",
        json={"external_ref": ref, "called_number": assign_number(owner_engine, a.org_id)},
        headers=h,
    )
    assert started.status_code == 201
    cid = started.json()["id"]
    request = {**body(rid="w-notices-001"), "conversation_id": ref}
    assert a.client.post("/v1/worker/live/brain", json=request, headers=h).status_code == 403
    first = a.client.post(
        f"/v1/worker/calls/{cid}/notice-playback",
        json={"notice": "ai_disclosure", "method": "livekit_speech_playout"},
        headers=h,
    )
    assert first.status_code == 200
    assert a.client.post("/v1/worker/live/brain", json=request, headers=h).status_code == 403
    assert live["llm_requests"] == []  # refusal precedes the budget reservation/provider
    assert (
        a.client.post(
            f"/v1/worker/calls/{cid}/notice-playback",
            json={"notice": "recording_notice", "method": "livekit_speech_playout"},
            headers=h,
        ).status_code
        == 200
    )
    live["llm"] = [(200, message([("text", {"parts": ["I can help."]})], "end_turn", 8, 3))]
    done = a.client.post("/v1/worker/live/brain", json=request, headers=h)
    assert done.status_code == 200 and events(done)[-1]["type"] == "done"
    assert len(live["llm_requests"]) == 1


def test_signed_ref_must_be_well_formed_even_for_valid_hmac(worker):
    org = uuid.uuid4()
    for bad_ref in ("", "short", "room/unsafe", "caller+44117946000", "r" * 65):
        with pytest.raises(worker_auth.WorkerAuthError, match="Invalid call reference"):
            worker_auth.mint(org, call_ref=bad_ref)
    signed = worker_auth.mint(org, call_ref="room-valid-ref-01")
    assert worker_auth.read_scoped(signed) == (org, "test", "simulated", "room-valid-ref-01")

    now = int(datetime.now(UTC).timestamp())
    forged = jwt.encode(
        {
            "iss": "voxera-api",
            "aud": "voxera-worker-brain",
            "org": str(org),
            "scope": "live:brain",
            "iat": now,
            "exp": now + 60,
            "mode": "test",
            "channel": "simulated",
            "call_ref": "invalid/ref",
        },
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(worker_auth.WorkerAuthError, match="Invalid call reference"):
        worker_auth.read_scoped(forged)


def test_live_phone_brain_requires_a_registered_active_call_even_after_mock_signoffs(
    worker,
    live,  # noqa: F811
    make_account,
    monkeypatch,
):
    from app.voice import launch

    a = make_account("bound-phone-brain@example.com")
    a.patch(a.o("/settings"), json={"locale": "en-GB"})
    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    approve_mock_llm_for_test(monkeypatch, a)
    ref = "room-phone-brain-001"
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref=ref)
    h = {"authorization": f"Bearer {token}"}
    wrong = {**body(rid="w-phone-wrong-001"), "conversation_id": "room-phone-brain-002"}
    assert a.client.post("/v1/worker/live/brain", json=wrong, headers=h).status_code == 403
    right = {**body(rid="w-phone-right-001"), "conversation_id": ref}
    assert a.client.post("/v1/worker/live/brain", json=right, headers=h).status_code == 403
    assert live["llm_requests"] == []


def test_a_telephone_call_can_never_use_test_mode(worker):
    org = uuid.uuid4()
    with pytest.raises(worker_auth.WorkerAuthError, match="live token"):
        worker_auth.mint(org, mode="test", channel="phone")
    with pytest.raises(worker_auth.WorkerAuthError, match="identify one call"):
        worker_auth.mint(org, mode="live", channel="phone")
    assert worker_auth.verify(worker_auth.mint(org, mode="live", channel="phone", call_ref="room-phone-001")) == (
        org,
        "live",
    )
    # A hand-made token claiming a phone channel in test mode, correctly signed: still refused.
    now = int(datetime.now(UTC).timestamp())
    crafted = {
        "iss": "voxera-api",
        "aud": "voxera-worker-brain",
        "org": str(org),
        "scope": "live:brain",
        "iat": now,
        "exp": now + 60,
        "mode": "test",
        "channel": "phone",
    }
    with pytest.raises(worker_auth.WorkerAuthError, match="live token"):
        worker_auth.verify(jwt.encode(crafted, SECRET, algorithm="HS256"))
    missing = {k: v for k, v in crafted.items() if k != "channel"} | {"mode": "test"}
    with pytest.raises(worker_auth.WorkerAuthError):
        worker_auth.verify(jwt.encode(missing, SECRET, algorithm="HS256"))


def test_a_live_phone_token_is_still_launch_gated(worker, live, make_account):  # noqa: F811
    a = make_account("a@example.com")
    token = worker_auth.mint(uuid.UUID(a.org_id), mode="live", channel="phone", call_ref="room-phone-001")
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 403 and live["llm_requests"] == []
