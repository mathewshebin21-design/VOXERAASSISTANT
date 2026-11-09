"""Call records: the lifecycle of one receptionist call and its append-only event log.

Lifecycle: a call starts ``in_progress`` and ends exactly once, as ``completed``, ``failed`` or
``abandoned`` (the housekeeping job abandons calls with no activity for two hours). Events can
only be added while the call is in progress. Each append locks the call row, so events from
concurrent writers (the brain and the client) get unique, gap-free sequence numbers.

Consent: transcript text is stored only if the caller heard the recording notice
(``transcript_retained``). Otherwise events keep their kind, speaker and data but not the words.
Audio is never stored.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .models import Call, CallEvent

MAX_EVENTS_PER_CALL = 2000
MAX_DATA_CHARS = 2000
TERMINAL = ("completed", "failed", "abandoned")


class CallError(Exception):
    """A request that conflicts with the call's state. ``status`` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def start(
    db: Session,
    org_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    channel: str,
    external_ref: str | None,
    caller_number: str | None,
    caller_name: str | None,
    ai_disclosure_played: bool,
    recording_notice_played: bool,
) -> tuple[Call, bool]:
    """Starts a call. Idempotent on ``external_ref``: the same reference returns the first call."""
    values = {
        "id": uuid.uuid4(),
        "organization_id": org_id,
        "channel": channel,
        "status": "in_progress",
        "external_ref": external_ref,
        "caller_number": caller_number,
        "caller_name": caller_name,
        "ai_disclosure_played": ai_disclosure_played,
        "recording_notice_played": recording_notice_played,
        "transcript_retained": recording_notice_played,
        "created_by": user_id,
    }
    stmt = insert(Call).values(**values)
    if external_ref is not None:
        stmt = stmt.on_conflict_do_nothing(constraint="uq_call_external_ref")
    new_id = db.execute(stmt.returning(Call.id)).scalar()
    if new_id is None:
        existing = db.scalar(select(Call).where(Call.organization_id == org_id, Call.external_ref == external_ref))
        assert existing is not None
        return existing, False
    call = db.get(Call, new_id)
    assert call is not None
    return call, True


def get(db: Session, org_id: uuid.UUID, call_id: uuid.UUID, *, lock: bool = False) -> Call:
    q = select(Call).where(Call.organization_id == org_id, Call.id == call_id)
    call = db.scalar(q.with_for_update() if lock else q)
    if call is None:
        raise CallError(404, "Call not found")
    return call


def append(db: Session, org_id: uuid.UUID, call_id: uuid.UUID, events: list[dict[str, Any]]) -> list[CallEvent]:
    """Adds events in order. Locks the call row; refuses ended calls and overlong logs."""
    call = get(db, org_id, call_id, lock=True)
    if call.status != "in_progress":
        raise CallError(409, "The call has ended; no more events can be added")
    if call.event_count + len(events) > MAX_EVENTS_PER_CALL:
        raise CallError(409, f"A call can hold at most {MAX_EVENTS_PER_CALL} events")
    rows = []
    for i, e in enumerate(events, start=1):
        data = dict(e.get("data") or {})
        if len(json.dumps(data, default=str)) > MAX_DATA_CHARS:
            raise CallError(422, f"Event data is limited to {MAX_DATA_CHARS} characters")
        text = e.get("text")
        if text is not None and not call.transcript_retained:
            text, data["text_withheld"] = None, True
        rows.append(
            CallEvent(
                organization_id=org_id,
                call_id=call.id,
                seq=call.event_count + i,
                kind=e["kind"],
                speaker=e.get("speaker"),
                text=text,
                data=data,
            )
        )
    db.add_all(rows)
    call.event_count += len(rows)
    call.last_activity_at = datetime.now(UTC)
    db.flush()
    return rows


def end(
    db: Session, org_id: uuid.UUID, call_id: uuid.UUID, status: str, outcome: str | None, reason: str | None
) -> Call:
    """Ends a call once, and stores a summary computed from its events."""
    if status not in TERMINAL:
        raise CallError(422, "A call ends as completed, failed or abandoned")
    call = get(db, org_id, call_id, lock=True)
    if call.status != "in_progress":
        raise CallError(409, f"The call already ended ({call.status})")
    now = datetime.now(UTC)
    call.status, call.outcome, call.end_reason, call.ended_at = status, outcome, reason, now
    call.last_activity_at = now
    call.summary = summarise(db, call, now)
    db.flush()
    return call


def summarise(db: Session, call: Call, ended_at: datetime) -> dict[str, Any]:
    events = list(db.scalars(select(CallEvent).where(CallEvent.call_id == call.id).order_by(CallEvent.seq)))
    tools: dict[str, int] = {}
    tokens = {"input": 0, "cache_read": 0, "output": 0}
    first_text: list[int] = []
    for e in events:
        if e.kind == "tool":
            name = str(e.data.get("name", "?"))
            tools[name] = tools.get(name, 0) + 1
        m = e.data.get("metrics") if isinstance(e.data, dict) else None
        if isinstance(m, dict):
            tokens["input"] += int(m.get("input_tokens", 0) or 0)
            tokens["cache_read"] += int(m.get("cache_read_tokens", 0) or 0)
            tokens["output"] += int(m.get("output_tokens", 0) or 0)
            if isinstance(m.get("first_text_ms"), int):
                first_text.append(m["first_text_ms"])
    return {
        "duration_ms": int((ended_at - call.started_at).total_seconds() * 1000),
        "events": len(events),
        "caller_turns": sum(e.kind == "utterance" and e.speaker == "caller" for e in events),
        "agent_turns": sum(e.kind == "utterance" and e.speaker == "agent" for e in events),
        "tools": tools,
        "errors": sum(e.kind == "error" for e in events),
        "handoffs": sum(e.kind == "handoff" for e in events),
        "tokens": tokens,
        "first_text_ms_max": max(first_text) if first_text else None,
    }


def delete(db: Session, org_id: uuid.UUID, call_id: uuid.UUID) -> Call:
    call = get(db, org_id, call_id, lock=True)
    db.delete(call)  # events go with it (ON DELETE CASCADE)
    db.flush()
    return call
