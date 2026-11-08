"""Scoped voice-worker credentials and the worker brain endpoint (ADR-0005 §3)."""

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


def test_worker_token_drives_the_brain_for_its_workspace_only(worker, live, make_account, owner_engine):  # noqa: F811
    a, b = make_account("a@example.com"), make_account("b@example.com")
    setup_business(a)
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
    live["llm"] = [(200, message([("text", {"parts": ["Hello."]})], "end_turn", 10, 2))]
    r = a.client.post("/v1/worker/live/brain", json=body(), headers={"authorization": f"Bearer {token}"})
    assert r.status_code == 200
    with pytest.raises(worker_auth.WorkerAuthError):
        worker_auth.mint(uuid.UUID(a.org_id), mode="production")
