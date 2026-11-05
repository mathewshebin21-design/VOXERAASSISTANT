"""Real PostgreSQL coverage for in-place, tenant-scoped appointment moves."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from zoneinfo import ZoneInfo

import pytest

from app import audit

from .conftest import join
from .test_desk import book, next_week_at, setup_salon


def move(account, appointment, when):
    return account.post(
        account.o(f"/appointments/{appointment['id']}/reschedule"), json={"starts_at": when.isoformat()}
    )


def test_overlapping_move_preserves_reference_and_is_retry_safe(make_account):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    target = next_week_at(10, 30)
    for _ in range(2):
        r = move(a, original, target)
        assert r.status_code == 200, r.text
        moved = r.json()
        assert moved["id"] == original["id"] and moved["created_at"] == original["created_at"]
        assert datetime.fromisoformat(moved["starts_at"]) == target
        assert moved["status"] == "booked" and moved["cancelled_at"] is None
    rows = a.get(a.o("/appointments?include_cancelled=true")).json()
    assert len(rows) == 1
    history = a.get(a.o("/audit-logs?action=appointment.rescheduled")).json()
    assert history[0]["target_id"] == original["id"]
    assert datetime.fromisoformat(history[-1]["details"]["from"]) == next_week_at(10)
    assert datetime.fromisoformat(history[-1]["details"]["to"]) == target
    assert book(a, svc, next_week_at(10), name="Other caller").status_code == 409
    assert book(a, svc, next_week_at(9)).status_code == 201  # old 10:00 start no longer blocks 09:00


def test_conflicting_move_leaves_original_booking_intact(make_account):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    assert book(a, svc, next_week_at(13)).status_code == 201
    assert move(a, original, next_week_at(12, 30)).status_code == 409
    rows = a.get(a.o("/appointments?include_cancelled=true")).json()
    assert len(rows) == 2
    assert next(row for row in rows if row["id"] == original["id"]) == original


@pytest.mark.parametrize("when", ["outside_hours", "quarter_hour", "past", "horizon", "microseconds"])
def test_invalid_moves_do_not_change_a_booking(make_account, when):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    target = {
        "outside_hours": next_week_at(16, 30),
        "quarter_hour": next_week_at(10, 10),
        "past": datetime.now(UTC) - timedelta(days=1),
        "horizon": next_week_at(10) + timedelta(days=70),
        "microseconds": next_week_at(10).replace(microsecond=1),
    }[when]
    assert move(a, original, target).status_code == 409
    assert a.get(a.o("/appointments")).json() == [original]


def test_cancelled_and_inactive_service_bookings_cannot_move(make_account):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    assert a.patch(a.o(f"/services/{svc}"), json={"active": False}).status_code == 200
    assert move(a, original, next_week_at(11)).status_code == 409
    assert a.post(a.o(f"/appointments/{original['id']}/cancel")).status_code == 200
    assert move(a, original, next_week_at(11)).status_code == 409


def test_move_uses_workspace_hours_for_an_explicit_foreign_offset(make_account):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    target = next_week_at(15).astimezone(ZoneInfo("Asia/Tokyo"))  # midnight there, 15:00 at the salon
    r = move(a, original, target)
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["starts_at"]) == target


def test_move_permissions_and_tenant_isolation(make_account):
    owner = make_account("owner@example.com")
    viewer = make_account("viewer@example.com")
    outsider = make_account("outsider@example.com")
    join(owner, viewer, "viewer")
    viewer.org_id = owner.org_id
    svc = setup_salon(owner)
    original = book(owner, svc, next_week_at(10)).json()
    assert move(viewer, original, next_week_at(11)).status_code == 403
    assert move(outsider, original, next_week_at(11)).status_code == 404
    assert owner.get(owner.o("/appointments")).json() == [original]


def test_move_availability_excludes_only_the_authorized_booking(make_account):
    a = make_account("move@example.com")
    b = make_account("other@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    path = f"/availability?service_id={svc}&on={next_week_at(10).date()}"
    normal = a.get(a.o(path)).json()["slots"]
    moving = a.get(a.o(path + f"&appointment_id={original['id']}")).json()["slots"]
    start = next_week_at(10)
    assert start not in [datetime.fromisoformat(slot) for slot in normal]
    assert start in [datetime.fromisoformat(slot) for slot in moving]
    assert b.get(b.o(path + f"&appointment_id={original['id']}")).status_code == 404


def test_audit_failure_rolls_back_the_move(make_account, monkeypatch):
    a = make_account("move@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    attempted = []

    def fail(*args, **kwargs):
        attempted.append(True)
        raise RuntimeError("injected audit failure")

    monkeypatch.setattr(audit, "record", fail)
    response = move(a, original, next_week_at(11))
    assert attempted == [True]  # the fault really occurred; the HTTP middleware returns a safe 500
    assert response.status_code == 500 and response.json()["detail"] == "Internal server error"
    assert "injected audit failure" not in response.text
    assert a.get(a.o("/appointments")).json() == [original]


def test_two_moves_cannot_take_the_same_last_slot(make_account):
    a = make_account("race@example.com")
    svc = setup_salon(a)
    appointments = [book(a, svc, next_week_at(hour)).json() for hour in (10, 14)]
    barrier = Barrier(2)

    def attempt(appointment):
        barrier.wait(timeout=10)
        return move(a, appointment, next_week_at(12)).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(attempt, appointments))
    assert sorted(statuses) == [200, 409]
    rows = a.get(a.o("/appointments?include_cancelled=true")).json()
    assert {row["id"] for row in rows} == {row["id"] for row in appointments}
    assert all(row["status"] == "booked" for row in rows)
    assert sum(datetime.fromisoformat(row["starts_at"]) == next_week_at(12) for row in rows) == 1


def test_booking_and_move_share_capacity_lock(make_account):
    a = make_account("race@example.com")
    svc = setup_salon(a)
    original = book(a, svc, next_week_at(10)).json()
    barrier = Barrier(2)

    def attempt(kind):
        barrier.wait(timeout=10)
        response = move(a, original, next_week_at(13)) if kind == "move" else book(a, svc, next_week_at(13))
        return kind, response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = dict(pool.map(attempt, ["move", "book"]))
    assert sorted(results.values()) in ([200, 409], [201, 409])
    rows = a.get(a.o("/appointments")).json()
    assert sum(datetime.fromisoformat(row["starts_at"]) == next_week_at(13) for row in rows) == 1
    original_row = next(row for row in rows if row["id"] == original["id"])
    assert datetime.fromisoformat(original_row["starts_at"]) == next_week_at(13 if results["move"] == 200 else 10)
