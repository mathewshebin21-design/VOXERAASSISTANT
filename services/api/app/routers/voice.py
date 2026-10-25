"""Voice lab test sessions: measured pipeline latency, stored per workspace.

The server recomputes the summary from the submitted turns rather than trusting
client-side aggregates, so stored percentiles always match the stored turns.
"""

import math
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..models import VoiceTestSession
from ..permissions import Perm
from ..schemas import VoiceSessionDetail, VoiceSessionIn, VoiceSessionOut, VoiceTurnIn

router = APIRouter(prefix="/v1/orgs/{org_id}/voice-sessions", tags=["voice"])


def _pct(values: list[int], p: int) -> int | None:
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s), max(1, math.ceil(p / 100 * len(s)))) - 1]  # nearest rank, as in the web app


def summarise(turns: list[VoiceTurnIn]) -> dict:
    def stat(vals: list[int | None]) -> dict:
        v = [x for x in vals if x is not None]
        return {"n": len(v), "p50": _pct(v, 50), "p95": _pct(v, 95)}

    n = len(turns)
    greet = next((t for t in turns if t.input == "greeting"), None)
    return {
        "turns": n,
        "time_to_first_audio_ms": greet.e2eMs if greet else None,
        "e2e_ms": stat([t.e2eMs for t in turns if t.input in ("voice", "typed")]),
        "stt_ms": stat([t.sttMs for t in turns]),
        "brain_first_ms": stat([t.brainFirstMs for t in turns]),
        "tts_first_ms": stat([t.ttsFirstMs for t in turns]),
        "barge_in_recovery_ms": stat([t.bargeInRecoveryMs for t in turns]),
        "barge_ins": sum(t.interrupted for t in turns),
        "failure_rate": {s: round(sum(s in t.failures for t in turns) / n, 4) for s in ("stt", "brain", "tts")},
        "fallbacks": sum(len(t.fallbacks) for t in turns),
    }


@router.post("", response_model=VoiceSessionOut, status_code=status.HTTP_201_CREATED)
def save_session(
    body: VoiceSessionIn,
    ctx: Annotated[OrgContext, Depends(require(Perm.agent_write))],
    db: DB,
    request: Request,
    response: Response,
) -> VoiceTestSession:
    """Idempotent on client_session_id: saving the same test call twice returns the first copy."""
    values = body.model_dump(exclude={"turns"})
    stmt = (
        insert(VoiceTestSession)
        .values(
            organization_id=ctx.org_id,
            created_by=ctx.user.id,
            turns=[t.model_dump() for t in body.turns],
            summary=summarise(body.turns),
            **values,
        )
        .on_conflict_do_nothing(constraint="uq_voice_session_client_id")
        .returning(VoiceTestSession.id)
    )
    new_id = db.execute(stmt).scalar()
    row = db.scalar(
        select(VoiceTestSession).where(
            VoiceTestSession.organization_id == ctx.org_id,
            VoiceTestSession.client_session_id == body.client_session_id,
        )
    )
    assert row is not None
    if new_id is None:
        response.status_code = status.HTTP_200_OK
    else:
        audit.record(
            db,
            ctx.org_id,
            ctx.user.id,
            "voice_session.saved",
            "voice_test_session",
            row.id,
            {"turns": len(body.turns)},
            client_meta(request),
        )
    db.commit()
    return row


@router.get("", response_model=list[VoiceSessionOut])
def list_sessions(
    ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB, limit: int = Query(20, ge=1, le=100)
) -> list[VoiceTestSession]:
    q = select(VoiceTestSession).where(VoiceTestSession.organization_id == ctx.org_id)
    return list(db.scalars(q.order_by(VoiceTestSession.started_at.desc()).limit(limit)))


@router.get("/{session_id}", response_model=VoiceSessionDetail)
def get_session(
    session_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB
) -> VoiceTestSession:
    row = db.scalar(
        select(VoiceTestSession).where(
            VoiceTestSession.organization_id == ctx.org_id, VoiceTestSession.id == session_id
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row
