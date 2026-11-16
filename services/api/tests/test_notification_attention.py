"""Read-only staff notification visibility; no external delivery or scheduler enabled."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import set_tenant
from app.models import StaffNotificationOutbox

from .test_staff_notifications import new_ai_case


def test_internal_review_thresholds_are_read_only_and_do_not_claim_delivery(make_account, app_engine, owner_engine):
    owner = make_account("review-queue-owner@example.com")
    regular = new_ai_case(app_engine, owner.org_id)
    urgent = new_ai_case(app_engine, owner.org_id)

    with owner_engine.begin() as db:
        db.execute(
            text("UPDATE caller_messages SET created_at = :created WHERE id = :id"),
            {"id": regular, "created": datetime.now(UTC) - timedelta(minutes=31)},
        )
        db.execute(
            text("UPDATE caller_messages SET created_at = :created, urgent = true WHERE id = :id"),
            {"id": urgent, "created": datetime.now(UTC) - timedelta(minutes=6)},
        )

    result = owner.get(owner.o("/cases"))
    assert result.status_code == 200
    cases = {item["id"]: item for item in result.json()}
    assert len(cases) == 2
    for cid in (regular, urgent):
        notification = cases[str(cid)]["notification"]
        assert notification["channel"] == "staff_email"
        assert notification["state"] == "pending"
        assert notification["attempts"] == 0
        assert notification["needs_staff_review"] is True
        assert notification["review_reason"] == "staff_unacknowledged"
        assert notification["last_error_code"] is None
        assert cases[str(cid)]["staff_acknowledged_at"] is None
        assert owner.get(owner.o(f"/cases/{cid}")).json()["notification"] == notification

    with Session(app_engine) as db:
        set_tenant(db, org_id=uuid.UUID(owner.org_id))
        records = list(db.scalars(select(StaffNotificationOutbox)))
        assert len(records) == 2
        assert all(row.status == "pending" and row.attempts == 0 for row in records)

    manual = owner.post(owner.o("/cases"), json={"summary": "Staff logged case", "assign_to_me": True})
    assert manual.status_code == 201
    assert manual.json()["notification"] is None
    assert owner.get(owner.o(f"/cases/{manual.json()['id']}")).json()["notification"] is None


def test_provider_failure_needs_review_but_explicit_staff_ack_suppresses_alert(make_account, app_engine):
    owner = make_account("review-failed-owner@example.com")
    cid = new_ai_case(app_engine, owner.org_id)
    org = uuid.UUID(owner.org_id)

    # Simulate a failed provider with a direct isolated database update:
    # no external transport is connected and no real message is sent.
    with Session(app_engine) as db:
        set_tenant(db, org_id=org)
        row = db.scalar(select(StaffNotificationOutbox).where(StaffNotificationOutbox.case_id == cid))
        row.status = "dead"
        row.attempts = 1
        row.last_error_code = "permanent_reject"
        db.commit()

    unacknowledged = owner.get(owner.o(f"/cases/{cid}")).json()
    note = unacknowledged["notification"]
    assert note["state"] == "dead" and note["attempts"] == 1
    assert note["review_reason"] == "notification_failed"
    assert note["needs_staff_review"] is True
    assert note["last_error_code"] == "permanent_reject"

    # Assignment alone is not a staff acknowledgement.
    assigned = owner.post(owner.o(f"/cases/{cid}/assign"), json={"user_id": owner.user_id})
    assert assigned.status_code == 200
    assert assigned.json()["notification"]["needs_staff_review"] is True

    acknowledged = owner.post(owner.o(f"/cases/{cid}/acknowledge"))
    assert acknowledged.status_code == 200
    assert acknowledged.json()["notification"]["needs_staff_review"] is False
    assert acknowledged.json()["notification"]["review_reason"] is None
    assert acknowledged.json()["notification"]["state"] == "dead"  # old failure truth is preserved


def test_unacknowledged_review_is_tenant_scoped_and_resolved_cases_suppress_alerts(
    make_account, app_engine, owner_engine
):
    a = make_account("review-tenant-a@example.com")
    b = make_account("review-tenant-b@example.com")
    ca = new_ai_case(app_engine, a.org_id)
    cb = new_ai_case(app_engine, b.org_id)
    with owner_engine.begin() as db:
        db.execute(
            text("UPDATE caller_messages SET created_at = :created WHERE id IN (:one, :two)"),
            {"one": ca, "two": cb, "created": datetime.now(UTC) - timedelta(hours=2)},
        )
    assert b.get(b.o(f"/cases/{ca}")).status_code == 404
    assert a.get(a.o(f"/cases/{cb}")).status_code == 404
    assert len(a.get(a.o("/cases")).json()) == 1
    assert len(b.get(b.o("/cases")).json()) == 1
    assert b.get(b.o(f"/cases/{cb}")).json()["notification"]["needs_staff_review"] is True
    resolved = b.post(b.o(f"/cases/{cb}/resolve"), json={"resolution": "Staff reviewed this request"})
    assert resolved.status_code == 200
    assert resolved.json()["notification"]["needs_staff_review"] is False
    assert resolved.json()["notification"]["review_reason"] is None
    assert a.get(a.o(f"/cases/{ca}")).json()["notification"]["needs_staff_review"] is True
