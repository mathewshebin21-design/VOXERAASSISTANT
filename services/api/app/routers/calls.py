"""Call records API: start a call, add events, end it, list, read and erase.

Members who may test the agent (``agent_write``) start ``simulated`` and ``web`` calls here.
The voice worker records its calls through ``worker_router`` (/v1/worker/calls) with a scoped
worker token: the workspace and the channel come from the token, so a test token can only ever
record a simulated call, and a phone call needs a live token for a launch-ready country and the
dialled number must be one assigned to that workspace (migration 0012).
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
from ..models import Call, CallerMessage, CallerMessageKind, CallEvent
from ..permissions import Perm
from ..reception import DeskError, desk, leave_message, normalise_phone
from ..schemas import Strict
from ..voice import policy as policy_mod
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


E164 = Annotated[str, Field(pattern=r"^\+[1-9][0-9]{6,14}$")]


class WorkerCallStartIn(Strict):
    """No channel: it comes from the worker token. ``called_number`` (the number the caller dialled,
    E.164) is required for a telephone call and must be active for the token's workspace."""

    external_ref: Ref | None = None
    called_number: E164 | None = None
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


class WorkerNoticePlayedIn(Strict):
    """Worker report after a full, uninterrupted LiveKit TTS playout; not carrier receipt proof."""

    notice: Literal["ai_disclosure", "recording_notice"]
    method: Literal["livekit_speech_playout"]


class CallEndIn(Strict):
    status: Literal["completed", "failed"] = "completed"
    outcome: Outcome | None = None
    reason: str | None = Field(None, max_length=200)


class WorkerFallbackMessageIn(Strict):
    """Explicit simulated-call fallback; never a proof of staff notification."""

    caller_name: str = Field(min_length=1, max_length=120)
    caller_phone: str = Field(min_length=7, max_length=32)
    message: str = Field(min_length=1, max_length=500)


class WorkerFallbackMessageOut(Strict):
    saved: bool
    case_id: uuid.UUID
    destination: Literal["staff_queue"]


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
    if worker.call_ref is not None and body.external_ref != worker.call_ref:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Call reference does not match worker credential")
    if worker.channel == "phone" and worker.call_ref is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A telephone call needs its own signed reference")
    if worker.channel == "phone":
        # A client-supplied start flag is not evidence of speech playout. Always
        # start phone calls with no transcript retention and require a later
        # call-bound, ordered notice acknowledgement.
        if body.ai_disclosure_played or body.recording_notice_played:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Telephone notices require completed playout receipts")
        # The same answer whether the number is unknown, disabled or another workspace's: row-level
        # security hides other workspaces' numbers, so nothing here reveals who owns a number.
        if body.called_number is None or not policy_mod.owns_active_number(db, worker.org_id, body.called_number):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "That number is not set up for this workspace")
    elif body.called_number is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only telephone calls have a dialled number")
    call, created = calls_mod.start(
        db,
        worker.org_id,
        None,
        channel=_WORKER_CHANNEL[worker.channel],
        caller_name=None,
        **body.model_dump(exclude={"called_number"}),
    )
    if call.channel != _WORKER_CHANNEL[worker.channel] or call.created_by is not None:
        # The reference already names a member's test call, or a call on the other channel.
        raise HTTPException(status.HTTP_409_CONFLICT, "That reference belongs to a different kind of call")
    if not created and call.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "An ended call cannot be restarted")
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
    if worker.call_ref is not None and call.external_ref != worker.call_ref:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    return call


@worker_router.post("/{call_id}/notice-playback", response_model=CallOut)
def worker_notice_playback(
    call_id: uuid.UUID,
    body: WorkerNoticePlayedIn,
    worker: Annotated[WorkerContext, Depends(worker_context)],
    db: DB,
    request: Request,
) -> Call:
    """Record a completed speech-output checkpoint. Never infer remote carrier delivery.

    Only a signed, call-bound phone worker can attest a playout. The call row
    serializes notice order and retries. No user text or audio is stored here.
    The recording flag controls retention of *subsequent* utterance events only.
    """
    if worker.mode != "live" or worker.channel != "phone" or worker.call_ref is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a call-bound telephone worker may attest playout")
    try:
        call = calls_mod.get(db, worker.org_id, call_id, lock=True)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    if call.created_by is not None or call.channel != "phone" or call.external_ref != worker.call_ref:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    if call.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot attest notices after the call ended")
    if body.notice == "recording_notice" and not call.ai_disclosure_played:
        raise HTTPException(status.HTTP_409_CONFLICT, "AI disclosure must finish before recording notice")

    already = call.ai_disclosure_played if body.notice == "ai_disclosure" else call.recording_notice_played
    if already:
        return call  # retry receipt; do not duplicate an audit entry or system event
    if body.notice == "ai_disclosure":
        call.ai_disclosure_played = True
    else:
        call.recording_notice_played = True
        call.transcript_retained = True  # prior withheld text stays withheld permanently

    try:
        calls_mod.append(
            db,
            worker.org_id,
            call.id,
            [
                {
                    "kind": "system",
                    "speaker": "system",
                    "data": {"event": "notice_playout_reported", "notice": body.notice, "method": body.method},
                }
            ],
            trusted_notice_receipt=True,  # only this authenticated endpoint may preserve the checkpoint
        )
    except calls_mod.CallError as e:
        raise _fail(e) from None
    audit.record(
        db,
        worker.org_id,
        None,
        "call.notice_playout_reported",
        "call",
        call.id,
        {"notice": body.notice, "by": "worker"},
        client_meta(request),
    )
    db.commit()
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


@worker_router.post(
    "/{call_id}/fallback-message",
    response_model=WorkerFallbackMessageOut,
    status_code=status.HTTP_201_CREATED,
)
def worker_save_fallback_message(
    call_id: uuid.UUID,
    body: WorkerFallbackMessageIn,
    worker: Annotated[WorkerContext, Depends(worker_context)],
    db: DB,
    request: Request,
    response: Response,
) -> dict:
    """Atomically put a simulated fallback into the existing staff queue.

    A stored queue item is not a staff notification or a promise of callback.
    This test-only route requires both notice flags and cannot handle real calls.
    The call row serializes concurrent retries; a system event holds only the
    case ID, not caller content. No new schema or live provider is enabled.
    """
    if worker.mode != "test" or worker.channel != "simulated":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Fallback queue requires an authorized simulated test")
    if worker.call_ref is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Fallback messages require a call-bound credential")

    name, message = body.caller_name.strip(), body.message.strip()
    if not name or not message:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Caller name and message are required")
    try:
        phone = normalise_phone(body.caller_phone)
    except DeskError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Valid callback number is required") from None

    try:
        call = calls_mod.get(db, worker.org_id, call_id, lock=True)
    except calls_mod.CallError as e:
        raise _fail(e) from None
    if call.created_by is not None or call.channel != "simulated" or call.external_ref != worker.call_ref:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    if not call.ai_disclosure_played or not call.recording_notice_played:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Simulated call notices are required before saving details")

    # The call row remains locked until commit, so a duplicate request cannot
    # create a second case even when both requests arrive concurrently.
    prior_events = db.scalars(
        select(CallEvent).where(
            CallEvent.organization_id == worker.org_id,
            CallEvent.call_id == call.id,
            CallEvent.kind == "system",
        )
    )
    for event in prior_events:
        data = event.data if isinstance(event.data, dict) else {}
        if data.get("event") != "fallback_case_persisted":
            continue
        try:
            case_id = uuid.UUID(str(data["case_id"]))
        except (KeyError, ValueError, TypeError):
            raise HTTPException(status.HTTP_409_CONFLICT, "Previous fallback receipt is invalid") from None
        case = db.get(CallerMessage, case_id)
        if case is None or case.organization_id != worker.org_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Previous fallback case is unavailable")
        if (case.caller_name, case.caller_phone, case.summary) != (name, phone, message):
            raise HTTPException(status.HTTP_409_CONFLICT, "This call already has a different fallback message")
        response.status_code = status.HTTP_200_OK
        return {"saved": True, "case_id": case.id, "destination": "staff_queue"}

    if call.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "The call has ended")

    case = leave_message(
        db,
        desk(db, worker.org_id),
        CallerMessageKind.message,
        message,
        name,
        phone,
        reason="simulated worker fallback",
        source="voice_worker",
    )
    try:
        calls_mod.append(
            db,
            worker.org_id,
            call.id,
            [
                {
                    "kind": "system",
                    "speaker": "system",
                    "data": {"event": "fallback_case_persisted", "case_id": str(case.id)},
                }
            ],
        )
    except calls_mod.CallError as e:
        raise _fail(e) from None
    audit.record(
        db,
        worker.org_id,
        None,
        "case.created",
        "caller_message",
        case.id,
        {"source": "voice_worker", "call_id": str(call.id)},
        client_meta(request),
    )
    db.commit()
    return {"saved": True, "case_id": case.id, "destination": "staff_queue"}


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
