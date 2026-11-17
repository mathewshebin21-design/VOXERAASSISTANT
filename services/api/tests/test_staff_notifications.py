"""Durable notification staging and fake provider lifecycle tests, with real Postgres RLS.

No test sends email/SMS/push or enables an external provider. Provider acceptance
and remote delivery are two distinct, synthetic, explicitly invoked checkpoints.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import reception, staff_notifications
from app.db import set_tenant
from app.models import CallerMessage, CallerMessageKind, StaffNotificationAttempt, StaffNotificationOutbox


def new_ai_case(app_engine, org_id: str, *, source: str = "ai_receptionist") -> uuid.UUID:
    with Session(app_engine) as db:
        oid = uuid.UUID(org_id)
        set_tenant(db, org_id=oid)
        row = reception.leave_message(
            db,
            reception.desk(db, oid),
            CallerMessageKind.message,
            "Synthetic caller request - do not transmit",
            "Synthetic Person",
            "07700900123",
            source=source,
        )
        db.commit()
        return row.id


def test_saved_ai_message_queues_pii_free_intent_atomically_and_once(make_account, app_engine, owner_engine):
    a = make_account("outbox-a@example.com")
    case_id = new_ai_case(app_engine, a.org_id)
    with Session(app_engine) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        case = db.get(CallerMessage, case_id)
        first = db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == case_id))
        assert first is not None
        assert first.status == "pending" and first.channel == "staff_email"
        assert first.attempts == 0 and first.provider_ref is None
        assert first.provider_accepted_at is None and first.delivered_at is None
        assert first.organization_id == case.organization_id
        assert staff_notifications.enqueue_case(db, case).id == first.id
        db.commit()
        assert len(db.scalars(select(StaffNotificationOutbox)).all()) == 1
    with owner_engine.connect() as conn:
        columns = (
            conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_notification_outbox'"
                )
            )
            .scalars()
            .all()
        )
        assert not any(word in col for col in columns for word in ("caller", "phone", "email_address", "summary"))
        assert (
            conn.execute(
                text("SELECT count(*) FROM staff_notification_outbox WHERE case_id = :id"), {"id": case_id}
            ).scalar_one()
            == 1
        )

    # Human-authored staff cases are not automatically externally notified.
    manual = a.post(a.o("/cases"), json={"summary": "Staff entered this case", "assign_to_me": False})
    assert manual.status_code == 201
    with Session(app_engine) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        assert (
            db.scalar(
                select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == uuid.UUID(manual.json()["id"]))
            )
            is None
        )


def test_rollbacks_remove_case_and_notification_together(make_account, app_engine):
    a = make_account("outbox-rollback@example.com")
    with Session(app_engine) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        row = reception.leave_message(
            db,
            reception.desk(db, uuid.UUID(a.org_id)),
            CallerMessageKind.message,
            "synthetic",
            source="voice_worker",
        )
        cid = row.id
        assert db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == cid))
        db.rollback()
    with Session(app_engine) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        assert db.get(CallerMessage, cid) is None
        assert db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == cid)) is None


def test_fake_provider_acceptance_and_delivery_are_distinct_and_idempotent(make_account, app_engine):
    a = make_account("outbox-receipt@example.com")
    cid = new_ai_case(app_engine, a.org_id)
    org = uuid.UUID(a.org_id)
    clock = datetime.now(UTC) + timedelta(seconds=5)
    with Session(app_engine, expire_on_commit=False) as db:
        set_tenant(db, org_id=org)
        [leased] = staff_notifications.lease_due(db, org, now=clock)
        assert leased.case_id == cid and leased.status == "leased"
        assert leased.attempts == 1 and leased.lease_until is not None
        token, ident = leased.lease_token, leased.id
        db.commit()
        assert staff_notifications.lease_due(db, org, now=clock) == []
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.provider_accepted(db, org, ident, uuid.uuid4(), "fake-1", now=clock)
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.record_delivered(db, org, ident, "fake-1", now=clock)
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.provider_accepted(db, org, ident, token, "recipient@example.com", now=clock)
        accepted = staff_notifications.provider_accepted(db, org, ident, token, "fake-1", now=clock)
        assert accepted.status == "provider_accepted"
        assert accepted.provider_accepted_at is not None and accepted.delivered_at is None
        assert staff_notifications.provider_accepted(db, org, ident, token, "fake-1", now=clock) is accepted
        db.commit()
        assert staff_notifications.lease_due(db, org, now=clock + timedelta(days=1)) == []
        delivered = staff_notifications.record_delivered(db, org, ident, "fake-1", now=clock)
        assert delivered.status == "delivered" and delivered.delivered_at is not None
        assert staff_notifications.record_delivered(db, org, ident, "fake-1", now=clock) is delivered
        db.commit()
        events = db.scalars(
            select(StaffNotificationAttempt).where(StaffNotificationAttempt.notification_id == ident)
        ).all()
        assert sorted(e.result for e in events) == ["accepted", "reserved"]


def test_expired_lease_cannot_ack_and_bounded_retry_reaches_dead_letter(make_account, app_engine):
    a = make_account("outbox-retry@example.com")
    new_ai_case(app_engine, a.org_id)
    org = uuid.UUID(a.org_id)
    start = datetime.now(UTC) + timedelta(seconds=5)
    with Session(app_engine, expire_on_commit=False) as db:
        set_tenant(db, org_id=org)
        [first] = staff_notifications.lease_due(db, org, now=start)
        old_token, ident = first.lease_token, first.id
        db.commit()
        [second] = staff_notifications.lease_due(db, org, now=start + timedelta(seconds=121))
        assert second.id == ident and second.attempts == 2 and second.lease_token != old_token
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.retry_or_dead(db, org, ident, old_token, "timeout", now=start + timedelta(seconds=122))
        retry = staff_notifications.retry_or_dead(
            db, org, ident, second.lease_token, "rate_limited", now=start + timedelta(seconds=122)
        )
        assert retry.status == "retry" and retry.last_error_code == "rate_limited"
        db.commit()
        assert staff_notifications.lease_due(db, org, now=start + timedelta(seconds=200)) == []
        third_clock = start + timedelta(seconds=245)
        [third] = staff_notifications.lease_due(db, org, now=third_clock)
        assert third.attempts == 3
        with pytest.raises(staff_notifications.NotificationError):
            staff_notifications.retry_or_dead(db, org, ident, third.lease_token, "caller=07700900123", now=third_clock)
        last = staff_notifications.retry_or_dead(db, org, ident, third.lease_token, "permanent_reject", now=third_clock)
        assert last.status == "dead"
        db.commit()
        assert staff_notifications.lease_due(db, org, now=third_clock + timedelta(days=1)) == []
        assert sorted(
            set(
                db.scalars(
                    select(StaffNotificationAttempt.result).where(StaffNotificationAttempt.notification_id == ident)
                )
            )
        ) == ["dead", "reserved", "retry"]


def test_staff_acknowledgement_cancels_unsent_intent_and_tenant_rls_isolates(make_account, app_engine, owner_engine):
    a = make_account("outbox-tenant-a@example.com")
    b = make_account("outbox-tenant-b@example.com")
    ca, cb = new_ai_case(app_engine, a.org_id), new_ai_case(app_engine, b.org_id)
    with Session(app_engine, expire_on_commit=False) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        assert db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == cb)) is None
        assert staff_notifications.lease_due(db, uuid.UUID(b.org_id)) == []
        db.rollback()

    # Creating a receipt is an explicit action; assignment alone is not one.
    assigned = a.post(a.o(f"/cases/{ca}/assign"), json={"user_id": a.user_id})
    assert assigned.status_code == 200
    assert assigned.json()["notification"]["state"] == "pending"
    ack = a.post(a.o(f"/cases/{ca}/acknowledge"))
    assert ack.status_code == 200 and ack.json()["staff_acknowledged_by"] == a.user_id
    assert ack.json()["notification"]["state"] == "cancelled"
    with Session(app_engine, expire_on_commit=False) as db:
        set_tenant(db, org_id=uuid.UUID(a.org_id))
        row = db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == ca))
        assert row.status == "cancelled" and row.attempts == 0
        assert staff_notifications.lease_due(db, uuid.UUID(a.org_id)) == []
    with Session(app_engine, expire_on_commit=False) as db:
        set_tenant(db, org_id=uuid.UUID(b.org_id))
        [r] = staff_notifications.lease_due(db, uuid.UUID(b.org_id))
        assert r.case_id == cb
        db.rollback()
    # The owner role validates the FK: a fake cross-tenant reference fails at
    # the database layer even with RLS bypassed by a migration owner.
    with owner_engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                "INSERT INTO staff_notification_outbox "
                "(id, organization_id, case_id, channel, status, attempts, max_attempts) "
                "VALUES (:id,:org,:cid,'staff_email','pending',0,5)"
            ),
            {"id": uuid.uuid4(), "org": a.org_id, "cid": cb},
        )


def test_resolving_case_cancels_queued_retry_and_keeps_attempt_history(make_account, app_engine):
    owner = make_account("outbox-resolve-retry@example.com")
    case_id = new_ai_case(app_engine, owner.org_id)
    org_id = uuid.UUID(owner.org_id)
    now = datetime.now(UTC) + timedelta(seconds=1)
    with Session(app_engine) as db:
        set_tenant(db, org_id=org_id)
        [row] = staff_notifications.lease_due(db, org_id, now=now)
        notification_id = row.id
        staff_notifications.retry_or_dead(db, org_id, row.id, row.lease_token, "timeout", now=now)
        db.commit()

    case_url = owner.o(f"/cases/{case_id}")
    resolved = owner.post(case_url + "/resolve", json={"resolution": "Handled at the desk"})
    assert resolved.status_code == 200
    notification = resolved.json()["notification"]
    assert notification["state"] == "cancelled" and notification["attempts"] == 1
    assert notification["last_error_code"] == "timeout"
    reopened = owner.post(case_url + "/reopen")
    assert reopened.status_code == 200 and reopened.json()["notification"] == notification

    with Session(app_engine) as db:
        set_tenant(db, org_id=org_id)
        history = db.scalars(
            select(StaffNotificationAttempt.result).where(StaffNotificationAttempt.notification_id == notification_id)
        )
        assert sorted(history) == ["reserved", "retry"]
        assert staff_notifications.lease_due(db, org_id, now=now + timedelta(days=1)) == []
