"""Simulation-only notification dispatch: database commits, safety and idempotency."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import notification_simulator as simulator
from app import staff_notifications
from app.db import set_tenant
from app.models import StaffNotificationAttempt, StaffNotificationOutbox

from .test_staff_notifications import new_ai_case


def sessions(engine):
    return lambda: Session(engine, expire_on_commit=False)


def get_outbox(engine, org_id, case_id):
    with sessions(engine)() as db:
        set_tenant(db, org_id=uuid.UUID(org_id))
        return db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == case_id))


def test_simulated_acceptance_requires_two_durable_transactions_and_never_claims_delivery(make_account, app_engine):
    a = make_account("sim-accept@example.com")
    cid = new_ai_case(app_engine, a.org_id)
    org = uuid.UUID(a.org_id)
    fake = simulator.SimulatedTransport()
    output = simulator.simulate_batch(sessions(app_engine), org, fake)
    assert len(output) == 1
    assert output[0].state == "provider_accepted" and output[0].attempted
    assert len(fake.submitted_ids) == 1
    row = get_outbox(app_engine, a.org_id, cid)
    assert row.status == "provider_accepted"
    assert row.provider_ref == f"sim-{row.id.hex}"
    assert row.provider_accepted_at is not None and row.delivered_at is None
    assert row.attempts == 1
    assert simulator.simulate_batch(sessions(app_engine), org, fake) == []
    assert len(fake.submitted_ids) == 1
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        events = db.scalars(select(StaffNotificationAttempt).where(StaffNotificationAttempt.notification_id == row.id))
        assert sorted(e.result for e in events) == ["accepted", "reserved"]


def test_simulated_retry_is_bounded_and_does_not_send_at_backoff_time(make_account, app_engine):
    a = make_account("sim-retry@example.com")
    cid = new_ai_case(app_engine, a.org_id)
    org = uuid.UUID(a.org_id)
    ident = get_outbox(app_engine, a.org_id, cid).id
    fake = simulator.SimulatedTransport(outcomes={ident: "rate_limited"})
    base = datetime.now(UTC) + timedelta(seconds=10)
    failed = simulator.simulate_batch(sessions(app_engine), org, fake, now=base)
    assert [r.state for r in failed] == ["retry"]
    assert get_outbox(app_engine, a.org_id, cid).attempts == 1
    assert simulator.simulate_batch(sessions(app_engine), org, fake, now=base + timedelta(seconds=59)) == []
    fake.outcomes[ident] = "accepted"
    accepted = simulator.simulate_batch(sessions(app_engine), org, fake, now=base + timedelta(seconds=61))
    assert [r.state for r in accepted] == ["provider_accepted"]
    assert fake.submitted_ids == [ident, ident]  # same idempotency identity across retries
    row = get_outbox(app_engine, a.org_id, cid)
    assert row.attempts == 2 and row.provider_ref == f"sim-{ident.hex}"
    assert row.delivered_at is None


def test_simulated_permanent_rejection_stops_retry_and_tenant_isolation_holds(make_account, app_engine):
    a = make_account("sim-tenant-a@example.com")
    b = make_account("sim-tenant-b@example.com")
    ca, cb = new_ai_case(app_engine, a.org_id), new_ai_case(app_engine, b.org_id)
    ia = get_outbox(app_engine, a.org_id, ca).id
    ib = get_outbox(app_engine, b.org_id, cb).id
    fake = simulator.SimulatedTransport(outcomes={ia: "permanent_reject"})
    result = simulator.simulate_batch(sessions(app_engine), uuid.UUID(a.org_id), fake)
    assert len(result) == 1 and result[0].state == "dead"
    assert fake.submitted_ids == [ia]
    assert get_outbox(app_engine, a.org_id, ca).status == "dead"
    assert get_outbox(app_engine, b.org_id, cb).status == "pending"
    assert simulator.simulate_batch(sessions(app_engine), uuid.UUID(a.org_id), fake) == []
    assert ib not in fake.submitted_ids


@pytest.mark.parametrize("handle_case", ["acknowledge", "resolve"])
def test_case_handled_after_lease_is_cancelled_before_transport(make_account, app_engine, handle_case):
    owner = make_account(f"sim-handled-{handle_case}@example.com")
    cid = new_ai_case(app_engine, owner.org_id)
    org = uuid.UUID(owner.org_id)
    at = datetime.now(UTC) + timedelta(seconds=4)
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        [leased] = staff_notifications.lease_due(db, org, now=at)
        ident, token = leased.id, leased.lease_token
        db.commit()
    if handle_case == "acknowledge":
        assert owner.post(owner.o(f"/cases/{cid}/acknowledge")).status_code == 200
    else:
        assert owner.post(owner.o(f"/cases/{cid}/resolve"), json={"resolution": "Handled"}).status_code == 200
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        assert staff_notifications.cancel_leased_if_handled(db, org, ident, token, now=at) is True
        db.commit()
    assert get_outbox(app_engine, owner.org_id, cid).status == "cancelled"
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.provider_accepted(db, org, ident, token, "sim-ignored", now=at)


def test_unexpired_leased_case_is_not_cancelled_by_poll_and_stale_token_is_rejected(make_account, app_engine):
    owner = make_account("sim-lease@example.com")
    cid = new_ai_case(app_engine, owner.org_id)
    org = uuid.UUID(owner.org_id)
    start = datetime.now(UTC) + timedelta(seconds=4)
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        [row] = staff_notifications.lease_due(db, org, now=start)
        ident, token = row.id, row.lease_token
        db.commit()
    with sessions(app_engine)() as db:
        set_tenant(db, org_id=org)
        assert staff_notifications.cancel_leased_if_handled(db, org, ident, token, now=start) is False
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.cancel_leased_if_handled(db, org, ident, uuid.uuid4(), now=start)
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.cancel_leased_if_handled(
                db, org, ident, token, now=start + timedelta(seconds=121)
            )
        db.rollback()
    assert get_outbox(app_engine, owner.org_id, cid).status == "leased"


def test_simulator_refuses_production_environment_database_and_non_fake_adapter(monkeypatch):
    fake_db = SimpleNamespace(get_bind=lambda: SimpleNamespace(url=SimpleNamespace(database="voxera_production")))
    with pytest.raises(simulator.SimulationDisabled):
        simulator._test_database_only(fake_db)
    monkeypatch.setattr(simulator, "get_settings", lambda: SimpleNamespace(env="production"))
    test_db = SimpleNamespace(get_bind=lambda: SimpleNamespace(url=SimpleNamespace(database="voxera_test")))
    with pytest.raises(simulator.SimulationDisabled):
        simulator._test_database_only(test_db)
    with pytest.raises(simulator.SimulationDisabled):
        simulator.simulate_batch(lambda: None, uuid.uuid4(), object())
