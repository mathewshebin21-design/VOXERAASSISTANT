"""Staff side of the reception desk: appointments, presence, and the shared case queue."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select

from .. import audit, reception
from ..deps import DB, OrgContext, client_meta, require
from ..models import (
    Appointment,
    AppointmentStatus,
    CallerMessage,
    CallerMessageKind,
    CallerMessageStatus,
    CaseNote,
    DeskAgent,
    DeskStatus,
    Membership,
    Service,
    User,
)
from ..permissions import Perm
from ..schemas import (
    AppointmentIn,
    AppointmentOut,
    AssignIn,
    CaseDetail,
    CaseIn,
    CaseNoteOut,
    CaseOut,
    DeskMemberOut,
    NoteIn,
    PresenceIn,
    ResolveIn,
    SlotsOut,
)

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["desk"])
Reader = Annotated[OrgContext, Depends(require(Perm.read))]
Manager = Annotated[OrgContext, Depends(require(Perm.calls_manage))]


def _err(e: reception.DeskError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, str(e))


@router.get("/appointments", response_model=list[AppointmentOut])
def list_appointments(
    ctx: Reader,
    db: DB,
    start: datetime | None = Query(None, alias="from"),
    end: datetime | None = Query(None, alias="to"),
    include_cancelled: bool = False,
) -> list[Appointment]:
    start = start or datetime.now(UTC) - timedelta(days=1)
    end = end or start + timedelta(days=31)
    q = select(Appointment).where(
        Appointment.organization_id == ctx.org_id, Appointment.starts_at >= start, Appointment.starts_at < end
    )
    if not include_cancelled:
        q = q.where(Appointment.status == AppointmentStatus.booked)
    return list(db.scalars(q.order_by(Appointment.starts_at).limit(500)))


@router.get("/availability", response_model=SlotsOut)
def availability(ctx: Reader, db: DB, service_id: uuid.UUID, on: date | None = None) -> SlotsOut:
    svc = db.get(Service, service_id)
    if svc is None or svc.organization_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    d = reception.desk(db, ctx.org_id)
    return SlotsOut(service=svc.name, timezone=str(d.tz), slots=reception.available_slots(db, d, svc, on, limit=24))


@router.post("/appointments", response_model=AppointmentOut, status_code=status.HTTP_201_CREATED)
def create_appointment(body: AppointmentIn, ctx: Manager, db: DB, request: Request) -> Appointment:
    svc = db.get(Service, body.service_id)
    if svc is None or svc.organization_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    d = reception.desk(db, ctx.org_id)
    try:
        appt, _ = reception.book(
            db, d, svc, body.starts_at, body.customer_name, body.customer_phone, body.notes, "staff"
        )
    except reception.DeskError as e:
        raise _err(e) from None
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "appointment.created",
        "appointment",
        appt.id,
        {"service": svc.name, "starts_at": appt.starts_at.isoformat(), "source": "staff"},
        client_meta(request),
    )
    db.commit()
    return appt


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(appointment_id: uuid.UUID, ctx: Manager, db: DB, request: Request) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.organization_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if appt.status == AppointmentStatus.booked:
        reception.cancel(db, appt)
        audit.record(
            db,
            ctx.org_id,
            ctx.user.id,
            "appointment.cancelled",
            "appointment",
            appt.id,
            {"by": "staff"},
            client_meta(request),
        )
        db.commit()
    return appt


# ---------- the staff desk (several employees at once) ----------


def _case(db, ctx: OrgContext, case_id: uuid.UUID) -> CallerMessage:
    c = db.get(CallerMessage, case_id)
    if c is None or c.organization_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return c


def _names(db, ids) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_(ids)))}


def _out(c: CallerMessage, names: dict) -> CaseOut:
    o = CaseOut.model_validate(c)
    o.assignee_name = names.get(c.assigned_to)
    return o


def _detail(db, c: CallerMessage) -> CaseDetail:
    notes = list(db.scalars(select(CaseNote).where(CaseNote.case_id == c.id).order_by(CaseNote.created_at)))
    names = _names(db, [c.assigned_to, *(n.author_id for n in notes)])
    d = CaseDetail(**_out(c, names).model_dump())
    d.notes = [
        CaseNoteOut(**CaseNoteOut.model_validate(n).model_dump() | {"author_name": names.get(n.author_id)})
        for n in notes
    ]
    return d


def _desk_member(db, ctx: OrgContext, user_id: uuid.UUID) -> Membership:
    m = db.scalar(select(Membership).where(Membership.organization_id == ctx.org_id, Membership.user_id == user_id))
    if m is None or m.role not in reception.DESK_ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That person can't work the desk (viewers can't)")
    return m


@router.get("/desk/team", response_model=list[DeskMemberOut])
def desk_team(ctx: Reader, db: DB) -> list[DeskMemberOut]:
    """Who is on the desk right now and how many open cases each has."""
    counts = dict(
        db.execute(
            select(CallerMessage.assigned_to, func.count())
            .where(CallerMessage.organization_id == ctx.org_id, CallerMessage.status == CallerMessageStatus.in_progress)
            .group_by(CallerMessage.assigned_to)
        ).all()
    )
    agents = {a.user_id: a for a in db.scalars(select(DeskAgent).where(DeskAgent.organization_id == ctx.org_id))}
    rows = db.execute(
        select(Membership.user_id, Membership.role, User.full_name)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == ctx.org_id, Membership.role.in_(reception.DESK_ROLES))
        .order_by(User.full_name)
    ).all()
    return [
        DeskMemberOut(
            user_id=uid,
            full_name=name,
            role=role.value,
            status=agents[uid].status.value if uid in agents else DeskStatus.offline.value,
            status_since=agents[uid].status_since if uid in agents else None,
            open_cases=counts.get(uid, 0),
        )
        for uid, role, name in rows
    ]


@router.put("/desk/presence", response_model=DeskMemberOut)
def set_presence(body: PresenceIn, ctx: Manager, db: DB) -> DeskMemberOut:
    reception.set_presence(db, ctx.org_id, ctx.user.id, DeskStatus(body.status))
    db.commit()
    return next(m for m in desk_team(ctx, db) if m.user_id == ctx.user.id)


@router.get("/cases", response_model=list[CaseOut])
def list_cases(
    ctx: Reader,
    db: DB,
    state: CallerMessageStatus | None = Query(None, alias="status"),
    mine: bool = False,
    limit: int = Query(100, ge=1, le=300),
) -> list[CaseOut]:
    q = select(CallerMessage).where(CallerMessage.organization_id == ctx.org_id)
    if state:
        q = q.where(CallerMessage.status == state)
    if mine:
        q = q.where(CallerMessage.assigned_to == ctx.user.id)
    rows = list(db.scalars(q.order_by(CallerMessage.urgent.desc(), CallerMessage.created_at.desc()).limit(limit)))
    names = _names(db, [c.assigned_to for c in rows])
    return [_out(c, names) for c in rows]


@router.post("/cases", response_model=CaseDetail, status_code=status.HTTP_201_CREATED)
def log_case(body: CaseIn, ctx: Manager, db: DB, request: Request) -> CaseDetail:
    d = reception.desk(db, ctx.org_id)
    try:
        c = reception.leave_message(
            db,
            d,
            CallerMessageKind.message,
            body.summary,
            body.caller_name,
            body.caller_phone,
            urgent=body.urgent,
            source="staff",
        )
    except reception.DeskError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    if body.assign_to_me:
        reception.reassign(db, c, ctx.user.id)
    audit.record(db, ctx.org_id, ctx.user.id, "case.created", "caller_message", c.id, None, client_meta(request))
    db.commit()
    return _detail(db, c)


@router.get("/cases/{case_id}", response_model=CaseDetail)
def get_case(case_id: uuid.UUID, ctx: Reader, db: DB) -> CaseDetail:
    return _detail(db, _case(db, ctx, case_id))


@router.post("/cases/{case_id}/claim", response_model=CaseDetail)
def claim_case(case_id: uuid.UUID, ctx: Manager, db: DB, request: Request) -> CaseDetail:
    c = _case(db, ctx, case_id)
    if not reception.claim(db, c, ctx.user.id):
        who = _names(db, [c.assigned_to]).get(c.assigned_to, "a colleague")
        raise HTTPException(status.HTTP_409_CONFLICT, f"{who} has already taken this case")
    audit.record(db, ctx.org_id, ctx.user.id, "case.claimed", "caller_message", c.id, None, client_meta(request))
    db.commit()
    return _detail(db, c)


@router.post("/cases/{case_id}/assign", response_model=CaseDetail)
def assign_case(case_id: uuid.UUID, body: AssignIn, ctx: Manager, db: DB, request: Request) -> CaseDetail:
    c = _case(db, ctx, case_id)
    if body.user_id is not None:
        _desk_member(db, ctx, body.user_id)
    reception.reassign(db, c, body.user_id)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "case.assigned",
        "caller_message",
        c.id,
        {"to": str(body.user_id) if body.user_id else None},
        client_meta(request),
    )
    db.commit()
    return _detail(db, c)


@router.post("/cases/{case_id}/notes", response_model=CaseDetail, status_code=status.HTTP_201_CREATED)
def add_case_note(case_id: uuid.UUID, body: NoteIn, ctx: Manager, db: DB) -> CaseDetail:
    c = _case(db, ctx, case_id)
    reception.add_note(db, c, ctx.user.id, body.body)
    db.commit()
    return _detail(db, c)


@router.post("/cases/{case_id}/resolve", response_model=CaseDetail)
def resolve_case(case_id: uuid.UUID, body: ResolveIn, ctx: Manager, db: DB, request: Request) -> CaseDetail:
    c = _case(db, ctx, case_id)
    reception.resolve(db, c, ctx.user.id, body.resolution)
    # Finished with a transferred caller and nothing else on? Back to available for the next one.
    me = db.get(DeskAgent, (ctx.org_id, ctx.user.id))
    still_open = db.scalar(
        select(func.count()).where(
            CallerMessage.organization_id == ctx.org_id,
            CallerMessage.assigned_to == ctx.user.id,
            CallerMessage.status == CallerMessageStatus.in_progress,
            CallerMessage.id != c.id,
        )
    )
    if me is not None and me.status == DeskStatus.busy and not still_open:
        reception.set_presence(db, ctx.org_id, ctx.user.id, DeskStatus.available)
    audit.record(db, ctx.org_id, ctx.user.id, "case.resolved", "caller_message", c.id, None, client_meta(request))
    db.commit()
    return _detail(db, c)


@router.post("/cases/{case_id}/reopen", response_model=CaseDetail)
def reopen_case(case_id: uuid.UUID, ctx: Manager, db: DB, request: Request) -> CaseDetail:
    c = _case(db, ctx, case_id)
    reception.reopen(db, c)
    audit.record(db, ctx.org_id, ctx.user.id, "case.reopened", "caller_message", c.id, None, client_meta(request))
    db.commit()
    return _detail(db, c)
