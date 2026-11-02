"""Reception desk logic shared by the AI receptionist's tools and the staff API.

Availability is computed from the workspace's opening hours, each service's duration and
buffer, existing bookings and the workspace's booking capacity (how many appointments can
run at once). Bookings are written under a per-workspace advisory lock, so two callers can
never be given the same last slot.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .models import (
    Appointment,
    AppointmentStatus,
    CallerMessage,
    CallerMessageKind,
    CallerMessageStatus,
    CaseNote,
    DeskAgent,
    DeskStatus,
    Membership,
    OfficeHours,
    Role,
    Service,
    User,
    WorkspaceSettings,
)

STEP = timedelta(minutes=15)
LEAD = timedelta(hours=1)  # earliest bookable start from now
HORIZON_DAYS = 60
PARTS = {"morning": (time(0), time(12)), "afternoon": (time(12), time(17)), "evening": (time(17), time(23, 59))}


class DeskError(ValueError):
    """A request the desk refuses; the message is safe to read out or show to staff."""


@dataclass
class Desk:
    org_id: uuid.UUID
    tz: ZoneInfo
    capacity: int
    transfer_phone: str | None


def desk(db: Session, org_id: uuid.UUID) -> Desk:
    s = db.get(WorkspaceSettings, org_id)
    return Desk(
        org_id,
        ZoneInfo(s.timezone if s else "Europe/London"),
        s.booking_capacity if s else 1,
        s.transfer_phone if s else None,
    )


def normalise_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw or "")
    plus = digits.startswith("+")
    digits = re.sub(r"\D", "", digits)
    if not 7 <= len(digits) <= 15:
        raise DeskError("That phone number doesn't look complete — could you read it out again?")
    return ("+" if plus else "") + digits


def find_service(db: Session, org_id: uuid.UUID, name: str) -> Service:
    services = list(db.scalars(select(Service).where(Service.organization_id == org_id, Service.active.is_(True))))
    want = name.strip().lower()
    if not want:
        raise DeskError("Which service? Ask the caller.")
    exact = [s for s in services if s.name.lower() == want]
    loose = exact or [s for s in services if want in s.name.lower() or s.name.lower() in want]
    if len(loose) == 1:
        return loose[0]
    if not loose:
        names = ", ".join(s.name for s in services) or "none listed yet"
        raise DeskError(f"No service called '{name}'. Services offered: {names}.")
    raise DeskError("That could be: " + ", ".join(s.name for s in loose) + ". Ask which one.")


def _hours(db: Session, org_id: uuid.UUID) -> dict[int, list[tuple[time, time]]]:
    out: dict[int, list[tuple[time, time]]] = {d: [] for d in range(7)}
    for h in db.scalars(select(OfficeHours).where(OfficeHours.organization_id == org_id)):
        out[h.weekday].append((h.opens_at, h.closes_at))
    return out


def _booked(db: Session, org_id: uuid.UUID, start: datetime, end: datetime) -> list[Appointment]:
    return list(
        db.scalars(
            select(Appointment).where(
                Appointment.organization_id == org_id,
                Appointment.status == AppointmentStatus.booked,
                Appointment.starts_at < end,
                Appointment.blocks_until > start,
            )
        )
    )


def _fits(d: Desk, hours: dict, svc: Service, start_local: datetime) -> bool:
    end_local = start_local + timedelta(minutes=svc.duration_min)
    for opens, closes in hours[start_local.weekday()]:
        if start_local.time() >= opens and end_local.time() <= closes and end_local.date() == start_local.date():
            return True
    return False


def _free(booked: list[Appointment], capacity: int, start: datetime, block_end: datetime) -> bool:
    return sum(1 for a in booked if a.starts_at < block_end and a.blocks_until > start) < capacity


def is_open(db: Session, d: Desk, now: datetime | None = None) -> bool:
    local = (now or datetime.now(UTC)).astimezone(d.tz)
    return any(o <= local.time() < c for o, c in _hours(db, d.org_id)[local.weekday()])


def available_slots(
    db: Session,
    d: Desk,
    svc: Service,
    on: date | None = None,
    part: str = "any",
    now: datetime | None = None,
    limit: int = 6,
) -> list[datetime]:
    """Bookable local start times: from `on` (or today) forward, at most two per day, up to `limit`."""
    now = now or datetime.now(UTC)
    earliest = now + LEAD
    first = on or now.astimezone(d.tz).date()
    hours = _hours(db, d.org_id)
    span_end = datetime.combine(first + timedelta(days=HORIZON_DAYS), time(0), d.tz)
    booked = _booked(db, d.org_id, datetime.combine(first, time(0), d.tz), span_end)
    dur, buf = timedelta(minutes=svc.duration_min), timedelta(minutes=svc.buffer_min)
    lo, hi = PARTS.get(part, (time(0), time(23, 59)))
    out: list[datetime] = []
    days = 1 if on else HORIZON_DAYS
    for i in range(days):
        day = first + timedelta(days=i)
        per_day = 0
        for opens, closes in sorted(hours[day.weekday()]):
            t = datetime.combine(day, opens, d.tz)
            while t + dur <= datetime.combine(day, closes, d.tz) and per_day < (limit if on else 2):
                if t >= earliest and lo <= t.time() < hi and _free(booked, d.capacity, t, t + dur + buf):
                    out.append(t)
                    per_day += 1
                    t += max(dur, STEP)  # offer spread-out times, not every 15 minutes
                    continue
                t += STEP
        if len(out) >= limit:
            break
    return out[:limit]


def book(
    db: Session,
    d: Desk,
    svc: Service,
    start_local: datetime,
    name: str,
    phone: str,
    notes: str | None,
    source: str,
    key: str | None = None,
    now: datetime | None = None,
) -> tuple[Appointment, bool]:
    """Creates a booking (or returns the existing one for the same idempotency key). Returns (appointment, created)."""
    if not svc.bookable_by_agent and source == "ai_receptionist":
        raise DeskError(f"{svc.name} has to be booked by the team directly.")
    name = name.strip()
    if not 1 <= len(name) <= 120:
        raise DeskError("I need the caller's name for the booking.")
    phone = normalise_phone(phone)
    if start_local.tzinfo is None:
        start_local = start_local.replace(tzinfo=d.tz)
    now = now or datetime.now(UTC)
    if key:
        existing = db.scalar(
            select(Appointment).where(Appointment.organization_id == d.org_id, Appointment.idempotency_key == key)
        )
        if existing:
            return existing, False
    if start_local < now + LEAD:
        raise DeskError("That time is too soon or has passed. Offer a later time.")
    if start_local.date() > (now.astimezone(d.tz).date() + timedelta(days=HORIZON_DAYS)):
        raise DeskError(f"Bookings can only be made up to {HORIZON_DAYS} days ahead.")
    if (start_local.minute % 15) or start_local.second:
        raise DeskError("Appointments start on the quarter hour.")
    hours = _hours(db, d.org_id)
    if not _fits(d, hours, svc, start_local):
        raise DeskError("That time is outside opening hours for this service. Check availability first.")
    start = start_local.astimezone(UTC)
    end = start + timedelta(minutes=svc.duration_min)
    block_end = end + timedelta(minutes=svc.buffer_min)
    # Serialise bookings per workspace (transaction-scoped lock), then re-check capacity.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"bookings:{d.org_id}"})
    if not _free(_booked(db, d.org_id, start, block_end), d.capacity, start, block_end):
        raise DeskError("Sorry, that slot has just been taken. Offer the next available time.")
    appt = Appointment(
        organization_id=d.org_id,
        service_id=svc.id,
        service_name=svc.name,
        starts_at=start,
        ends_at=end,
        blocks_until=block_end,
        customer_name=name,
        customer_phone=phone,
        notes=(notes or "").strip()[:500] or None,
        status=AppointmentStatus.booked,
        source=source,
        idempotency_key=key,
    )
    db.add(appt)
    db.flush()
    return appt, True


def upcoming_for_phone(db: Session, d: Desk, phone: str, now: datetime | None = None) -> list[Appointment]:
    phone = normalise_phone(phone)
    tail = re.sub(r"\D", "", phone)[-9:]  # match regardless of +44 / 0 prefix
    rows = db.scalars(
        select(Appointment)
        .where(
            Appointment.organization_id == d.org_id,
            Appointment.status == AppointmentStatus.booked,
            Appointment.starts_at >= (now or datetime.now(UTC)),
            func.right(func.regexp_replace(Appointment.customer_phone, r"\D", "", "g"), 9) == tail,
        )
        .order_by(Appointment.starts_at)
        .limit(10)
    )
    return list(rows)


def owned_appointment(db: Session, d: Desk, ref: str, phone: str) -> Appointment:
    """The caller's own upcoming booking by reference; never reveals or touches anyone else's."""
    ref = ref.strip().lower()
    for a in upcoming_for_phone(db, d, phone):
        if str(a.id).startswith(ref) and len(ref) >= 6:
            return a
    raise DeskError("I can't find a booking with that reference for this phone number.")


def cancel(db: Session, a: Appointment) -> None:
    a.status = AppointmentStatus.cancelled
    a.cancelled_at = datetime.now(UTC)


def reschedule(db: Session, d: Desk, a: Appointment, new_start_local: datetime) -> Appointment:
    svc = db.get(Service, a.service_id) if a.service_id else None
    if svc is None:
        raise DeskError("That service is no longer offered, so the team will need to rebook it.")
    new, _ = book(db, d, svc, new_start_local, a.customer_name, a.customer_phone, a.notes, a.source)
    cancel(db, a)
    return new


def leave_message(
    db: Session,
    d: Desk,
    kind: CallerMessageKind,
    summary: str,
    name: str | None = None,
    phone: str | None = None,
    reason: str | None = None,
    urgent: bool = False,
    source: str = "ai_receptionist",
) -> CallerMessage:
    m = CallerMessage(
        organization_id=d.org_id,
        kind=kind,
        caller_name=(name or "").strip()[:120] or None,
        caller_phone=normalise_phone(phone) if phone else None,
        summary=summary.strip()[:1000] or "(no details given)",
        reason=(reason or "").strip()[:200] or None,
        urgent=urgent,
        source=source,
    )
    db.add(m)
    db.flush()
    return m


# ---------- the staff desk: several employees working one shared queue ----------

DESK_ROLES = (Role.owner, Role.admin, Role.manager, Role.staff)


def _lock_desk(db: Session, org_id: uuid.UUID) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"desk:{org_id}"})


def set_presence(db: Session, org_id: uuid.UUID, user_id: uuid.UUID, status: DeskStatus) -> DeskAgent:
    a = db.get(DeskAgent, (org_id, user_id))
    if a is None:
        a = DeskAgent(organization_id=org_id, user_id=user_id, status=status, status_since=datetime.now(UTC))
        db.add(a)
    elif a.status != status:
        a.status, a.status_since = status, datetime.now(UTC)
    db.flush()
    return a


def pick_available_agent(db: Session, org_id: uuid.UUID) -> tuple[uuid.UUID, str] | None:
    """The available employee with the fewest open cases, then the one who waited longest."""
    open_cases = (
        select(CallerMessage.assigned_to, func.count().label("n"))
        .where(CallerMessage.organization_id == org_id, CallerMessage.status == CallerMessageStatus.in_progress)
        .group_by(CallerMessage.assigned_to)
        .subquery()
    )
    row = db.execute(
        select(DeskAgent.user_id, User.full_name)
        .join(Membership, (Membership.user_id == DeskAgent.user_id) & (Membership.organization_id == org_id))
        .join(User, User.id == DeskAgent.user_id)
        .outerjoin(open_cases, open_cases.c.assigned_to == DeskAgent.user_id)
        .where(
            DeskAgent.organization_id == org_id,
            DeskAgent.status == DeskStatus.available,
            Membership.role.in_(DESK_ROLES),
        )
        .order_by(func.coalesce(open_cases.c.n, 0), DeskAgent.last_assigned_at.asc().nulls_first())
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None


def _assign(db: Session, case: CallerMessage, user_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    case.assigned_to, case.assigned_at, case.status = user_id, now, CallerMessageStatus.in_progress
    agent = db.get(DeskAgent, (case.organization_id, user_id))
    if agent is not None:
        agent.last_assigned_at = now


@dataclass
class Handoff:
    case: CallerMessage
    outcome: str  # "transferred" | "queued" | "callback"
    staff_name: str | None = None


def hand_off(
    db: Session,
    d: Desk,
    summary: str,
    reason: str,
    name: str | None,
    phone: str | None,
    urgent: bool,
    now: datetime | None = None,
) -> Handoff:
    """Routes a caller who needs a person.

    Open and someone available → transferred to them (they're marked busy: they're on the call).
    Open but everyone busy    → queued for the next free employee, who calls back.
    Closed                    → callback request for when the business reopens.
    """
    _lock_desk(db, d.org_id)  # two simultaneous transfers never land on the same person
    if not is_open(db, d, now):
        case = leave_message(db, d, CallerMessageKind.callback, summary, name, phone, reason, urgent)
        return Handoff(case, "callback")
    pick = pick_available_agent(db, d.org_id)
    case = leave_message(db, d, CallerMessageKind.transfer, summary, name, phone, reason, urgent)
    if pick is None:
        return Handoff(case, "queued")
    user_id, full_name = pick
    _assign(db, case, user_id)
    set_presence(db, d.org_id, user_id, DeskStatus.busy)
    db.flush()
    return Handoff(case, "transferred", full_name.split(" ")[0])


def claim(db: Session, case: CallerMessage, user_id: uuid.UUID) -> bool:
    """Atomically takes an unassigned case. False if a colleague got there first."""
    res = db.execute(
        CallerMessage.__table__.update()
        .where(
            CallerMessage.id == case.id,
            CallerMessage.organization_id == case.organization_id,
            CallerMessage.assigned_to.is_(None),
            CallerMessage.status == CallerMessageStatus.new,
        )
        .values(
            assigned_to=user_id,
            assigned_at=datetime.now(UTC),
            status=CallerMessageStatus.in_progress,
            updated_at=datetime.now(UTC),
        )
    )
    db.refresh(case)
    return res.rowcount == 1


def reassign(db: Session, case: CallerMessage, user_id: uuid.UUID | None) -> None:
    if user_id is None:
        case.assigned_to, case.assigned_at, case.status = None, None, CallerMessageStatus.new
    else:
        _assign(db, case, user_id)


def resolve(db: Session, case: CallerMessage, user_id: uuid.UUID, resolution: str) -> None:
    case.status, case.resolution = CallerMessageStatus.resolved, resolution.strip()[:1000]
    case.resolved_at, case.resolved_by = datetime.now(UTC), user_id
    if case.assigned_to is None:
        case.assigned_to, case.assigned_at = user_id, datetime.now(UTC)


def reopen(db: Session, case: CallerMessage) -> None:
    case.status = CallerMessageStatus.in_progress if case.assigned_to else CallerMessageStatus.new
    case.resolution = case.resolved_at = case.resolved_by = None


def add_note(db: Session, case: CallerMessage, user_id: uuid.UUID, body: str) -> CaseNote:
    n = CaseNote(organization_id=case.organization_id, case_id=case.id, author_id=user_id, body=body.strip()[:2000])
    db.add(n)
    db.flush()
    return n


def spoken_time(dt: datetime) -> str:
    """'Friday 14 November at 2:30pm' — how a receptionist would say it."""
    h = dt.hour % 12 or 12
    mins = f":{dt.minute:02d}" if dt.minute else ""
    return f"{dt:%A} {dt.day} {dt:%B} at {h}{mins}{'am' if dt.hour < 12 else 'pm'}"
