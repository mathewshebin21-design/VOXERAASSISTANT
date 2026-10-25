import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def test_mutations_are_audited_with_actor(make_account):
    a = make_account("ada@example.com")
    a.post(a.o("/services"), json={"name": "Cut", "duration_min": 30})
    a.patch(a.o("/settings"), json={"recording_retention_days": 60})
    logs = a.get(a.o("/audit-logs")).json()
    actions = [l["action"] for l in logs]
    assert actions[:3] == ["settings.updated", "service.created", "organization.created"]
    assert all(l["actor_user_id"] == a.user_id for l in logs)
    assert logs[0]["details"]["to"] == {"recording_retention_days": 60}


def test_audit_log_is_append_only_for_api_role_and_owner(make_account, app_engine, owner_engine):
    a = make_account("ada@example.com")
    with app_engine.connect() as c, c.begin():
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": a.org_id})
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("UPDATE audit_logs SET action = 'tampered'"))
    with app_engine.connect() as c, c.begin():
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": a.org_id})
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("DELETE FROM audit_logs"))
    with owner_engine.connect() as c, c.begin(), pytest.raises(DBAPIError, match="append-only"):
        c.execute(text("UPDATE audit_logs SET action = 'tampered'"))


EV = {
    "kind": "call_minutes",
    "source": "live",
    "quantity": "3.5",
    "occurred_at": "2026-10-23T10:00:00+01:00",
    "idempotency_key": "call-0001-minutes",
}


def test_usage_recording_is_idempotent(make_account, owner_engine):
    a = make_account("ada@example.com")
    first = a.post(a.o("/usage-events"), json=EV)
    replay = a.post(a.o("/usage-events"), json=EV)
    assert first.status_code == 201 and replay.status_code == 200 and first.json()["id"] == replay.json()["id"]
    assert a.post(a.o("/usage-events"), json={**EV, "quantity": "9"}).status_code == 409
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM usage_events")).scalar() == 1


def test_usage_summary_separates_live_and_simulated(make_account):
    a = make_account("ada@example.com")
    a.post(a.o("/usage-events"), json=EV)
    a.post(
        a.o("/usage-events"), json={**EV, "source": "simulated", "quantity": "10", "idempotency_key": "sim-0001-min"}
    )
    a.post(
        a.o("/usage-events"),
        json={**EV, "occurred_at": "2026-11-01T00:30:00+00:00", "idempotency_key": "call-0002-minutes"},
    )
    s = a.get(a.o("/usage/summary?month=2026-10")).json()
    assert float(s["live"]["call_minutes"]) == 3.5
    assert float(s["simulated"]["call_minutes"]) == 10
    assert s["event_count"] == 2
    assert a.get(a.o("/usage/summary?month=2026-13")).status_code == 422


def test_usage_rejects_naive_timestamps_and_negative_quantities(make_account):
    a = make_account("ada@example.com")
    assert a.post(a.o("/usage-events"), json={**EV, "occurred_at": "2026-10-23T10:00:00"}).status_code == 422
    assert a.post(a.o("/usage-events"), json={**EV, "quantity": "-1"}).status_code == 422
