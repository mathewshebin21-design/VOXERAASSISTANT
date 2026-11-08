"""Call records API: start a call, add events, end it, list, read and erase.

Members who may test the agent (``agent_write``) start ``simulated`` and ``web`` calls here.
The voice worker records its calls through ``worker_router`` (/v1/worker/calls) with a scoped
worker token: the workspace and the channel come from the token, so a test token can only ever
record a simulated call, and a phone call needs a live token for a launch-ready country.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from .. import audit
from .. import calls as calls_mod
from ..deps import DB, OrgContext, client_meta, require
from ..models import Call, CallEvent
from ..permissions import Perm
from ..schemas import Strict
from ..worker_deps import WorkerContext, worker_context

router = APIRouter(prefix="/v1/orgs/{org_id}/calls", tags=["calls"])
worker_router = APIRouter(prefix="/v1/worker/calls", tags=["worker"])

Outcome = Literal[
    "booked", "rescheduled", "cancelled", "message_taken", "transferred", "answered", "emergency", "no_action"
]
Ref = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class CallStartIn(Strict):
    channel: Literal["simulated", "web"] = "simulated"
    external_ref: Ref | None = None
    caller_number: str | None = Field(None, max_length=32, pattern=r"^\+?[0-9 ()-]{3,31}$")
    caller_name: str | None = Field(None, max_length=120)
    ai_disclosure_played: bool = False
    recording_notice_played: bool = False


class WorkerCallStartIn(Strict):
    """No channel: it comes from the worker token."""

    external_ref: Ref | None = None
    caller_number: str | None = Field(None, max_length=32, pattern=r"^\+?[0-9 ()-]{3,31}$")
    ai_disclosure_played: bool = False
    recording_notice_played: bool = False


class CallEventIn(Strict):
    kind: Literal["utterance", "tool", "handoff", "system", "error"]
    speaker: Literal["caller", "agent", "system"] | None = None
    text: str | None = Field(None, max_length=4000)
    data: dict[str, Any] = Field(default_factory=dict)


class CallEventsIn(Strict):
    events: list[CallEventIn] = Field(min_length=1, max_length=50)


class CallEndIn(Strict):
    status: Literal["completed", "failed"] = "completed"
    outcome: Outcome | None = None
    reason: str | None = Field(None, max_length=200)


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CallOut(_Out):
    id: uuid.UUID
    channel: str
    status: str
    outcome: str | None
    external_ref: str | None
    caller_number: str | None
    caller_name: str | None
    ai_disclosure_played: bool
    recording_notice_played: bool
    transcript_retained: bool
    audio_stored: bool
    event_count: int
    summary: dict
    end_reason: str | None
    started_at: datetime
    last_activity_at: datetime
    ended_at: datetime | None


class CallEventOut(_Out):
    seq: int
    at: datetime
    kind: str
    speaker: str | None
    text: str | None
    data: dict


class CallDetail(CallOut):
    events: list[CallEventOut]


def _fail(e: calls_mod.CallError) -> HTTPException:
    return HTTPException(e.status, str(e))


@router.post("", response_model=CallOut, status_code=status.HTTP_201_CREATED)
def start_call(
    body: CallStartIn,
    ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))],
    db: DB,
    request: Request,
    response: Response,
) -> Call:
    """Starts a simulated or web test call. Idempotent on ``external_ref``."""
    call, created = calls_mod.start(db, ctx.org_id, ctx.user.id, **body.model_dump())
    if created:
        audit.record(
            db,
            ctx.org_id,
            ctx.user.id,
            "call.started",
            "call",
            call.id,
            {"channel": call.channel},
            client_meta(request),
        )
    else:
        response.status_code = status.HTTP_200_OK
    db.commit()
    return call


@router.post("/{call_id}/events", response_model=list[CallEventOut], status_code=status.HTTP_201_CREATED)
def add_events(
    call_id: uuid.UUID, body: CallEventsIn, ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))], db: DB
) -> list[CallEvent]:
    try:
        rows = calls_mod.append(db, ctx.org_id, call_id, [e.model_dump() for e in body.events])
    except calls_mod.CallError as e:
        raise _fail(e) from None
    db.commit()
    return rows


@router.post("/{call_id}/end", response_model=CallOut)
def end_call(
    call_id: uuid.UUID,
    body: CallEndIn,
    ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))],
    db: DB,
    request: Request,
) -> Call:
    try:
        call = calls_mod.end(db, ctx.org_id, call_id, body.status, body.outcome, body.reason)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "call.ended",
        "call",
        call.id,
        {"status": call.status, "outcome": call.outcome},
        client_meta(request),
    )
    db.commit()
    return call


@router.get("", response_model=list[CallOut])
def list_calls(
    ctx: Annotated[OrgContext, Depends(require(Perm.read))],
    db: DB,
    status_: Annotated[Literal["in_progress", "completed", "failed", "abandoned"] | None, Query(alias="status")] = None,
    channel: Literal["simulated", "web", "phone"] | None = None,
    before: datetime | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[Call]:
    """Newest first. Page with ``before`` set to the last call's ``started_at``."""
    q = select(Call).where(Call.organization_id == ctx.org_id)
    if status_:
        q = q.where(Call.status == status_)
    if channel:
        q = q.where(Call.channel == channel)
    if before:
        q = q.where(Call.started_at < before)
    return list(db.scalars(q.order_by(Call.started_at.desc(), Call.id.desc()).limit(limit)))


@router.get("/{call_id}", response_model=CallDetail)
def get_call(call_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> dict:
    try:
        call = calls_mod.get(db, ctx.org_id, call_id)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    events = db.scalars(select(CallEvent).where(CallEvent.call_id == call.id).order_by(CallEvent.seq))
    return {**CallOut.model_validate(call).model_dump(), "events": list(events)}


@router.delete("/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_call(
    call_id: uuid.UUID,
    ctx: Annotated[OrgContext, Depends(require(Perm.data_export))],
    db: DB,
    request: Request,
) -> None:
    """Erases a call and its transcript (e.g. for a caller's erasure request). Owner only."""
    try:
        call = calls_mod.delete(db, ctx.org_id, call_id)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    # The audit row records that a call was erased, never what it contained.
    audit.record(
        db, ctx.org_id, ctx.user.id, "call.deleted", "call", call.id, {"channel": call.channel}, client_meta(request)
    )
    db.commit()


# ---- the voice worker (scoped worker token; no member account) ------------------------------

_WORKER_CHANNEL = {"simulated": "simulated", "phone": "phone"}


@worker_router.post("", response_model=CallOut, status_code=status.HTTP_201_CREATED)
def worker_start_call(
    body: WorkerCallStartIn,
    worker: Annotated[WorkerContext, Depends(worker_context)],
    db: DB,
    request: Request,
    response: Response,
) -> Call:
    """Starts the worker's call record. Idempotent on ``external_ref`` (e.g. the room or SIP call ID),
    so a worker that restarts mid-call continues the same record."""
    call, created = calls_mod.start(
        db,
        worker.org_id,
        None,
        channel=_WORKER_CHANNEL[worker.channel],
        caller_name=None,
        **body.model_dump(),
    )
    if call.channel != _WORKER_CHANNEL[worker.channel] or call.created_by is not None:
        # The reference already names a member's test call, or a call on the other channel.
        raise HTTPException(status.HTTP_409_CONFLICT, "That reference belongs to a different kind of call")
    if created:
        meta = client_meta(request)
        audit.record(
            db, worker.org_id, None, "call.started", "call", call.id, {"channel": call.channel, "by": "worker"}, meta
        )
    else:
        response.status_code = status.HTTP_200_OK
    db.commit()
    return call


def _worker_call(db: DB, worker: WorkerContext, call_id: uuid.UUID) -> Call:
    """The worker's own channel only: a worker never writes to a member's test or web call."""
    try:
        call = calls_mod.get(db, worker.org_id, call_id)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    if call.channel != _WORKER_CHANNEL[worker.channel] or call.created_by is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    return call


@worker_router.post("/{call_id}/events", response_model=list[CallEventOut], status_code=status.HTTP_201_CREATED)
def worker_add_events(
    call_id: uuid.UUID, body: CallEventsIn, worker: Annotated[WorkerContext, Depends(worker_context)], db: DB
) -> list[CallEvent]:
    _worker_call(db, worker, call_id)
    try:
        rows = calls_mod.append(db, worker.org_id, call_id, [e.model_dump() for e in body.events])
    except calls_mod.CallError as e:
        raise _fail(e) from None
    db.commit()
    return rows


@worker_router.post("/{call_id}/end", response_model=CallOut)
def worker_end_call(
    call_id: uuid.UUID,
    body: CallEndIn,
    worker: Annotated[WorkerContext, Depends(worker_context)],
    db: DB,
    request: Request,
) -> Call:
    _worker_call(db, worker, call_id)
    try:
        call = calls_mod.end(db, worker.org_id, call_id, body.status, body.outcome, body.reason)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    details = {"status": call.status, "outcome": call.outcome, "by": "worker"}
    audit.record(db, worker.org_id, None, "call.ended", "call", call.id, details, client_meta(request))
    db.commit()
    return call
