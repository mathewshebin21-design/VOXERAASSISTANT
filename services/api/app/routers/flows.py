"""Agent Studio API: an agent's conversation flow — draft, validation, publish, versions, rollback.

Edits only change the draft (autosaved with a revision number so two editors can't overwrite
each other). Publishing validates the draft and stores an immutable numbered version; calls run
the published version only, so an unpublished draft never changes what callers hear.
"""

import copy
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..flows import engine
from ..flows.schema import Flow
from ..flows.templates import default_flow
from ..flows.validate import validate
from ..models import Agent, AgentFlow, AgentFlowVersion, FlowSession
from ..permissions import Perm
from ..schemas import Strict

router = APIRouter(prefix="/v1/orgs/{org_id}/agents/{agent_id}/flow", tags=["agent studio"])
Reader = Annotated[OrgContext, Depends(require(Perm.read))]
Writer = Annotated[OrgContext, Depends(require(Perm.agent_write))]


class DraftIn(Strict):
    graph: dict[str, Any]
    base_revision: int = Field(ge=1)


class PublishIn(Strict):
    base_revision: int = Field(ge=1)
    note: str = Field("", max_length=200)


class ValidateIn(Strict):
    graph: dict[str, Any]


class RollbackIn(Strict):
    note: str = Field("", max_length=200)


def parse(graph: dict[str, Any]) -> Flow:
    """A flow document, or 422 with the structural problems (unknown node types, bad ids…)."""
    try:
        return Flow.model_validate(graph)
    except ValidationError as e:
        detail = [
            {"loc": ".".join(str(p) for p in x["loc"]), "msg": x["msg"]} for x in e.errors(include_url=False)[:20]
        ]
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": "Not a valid flow", "errors": detail}
        ) from None


def _agent(db: Session, org_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    a = db.scalar(select(Agent).where(Agent.id == agent_id, Agent.organization_id == org_id))
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
    return a


def _flow(db: Session, org_id: uuid.UUID, agent: Agent, *, lock: bool = False) -> AgentFlow:
    q = select(AgentFlow).where(AgentFlow.agent_id == agent.id, AgentFlow.organization_id == org_id)
    f = db.scalar(q.with_for_update() if lock else q)
    if f is None:  # first open: start from the ready-made receptionist, greeting kept
        f = AgentFlow(
            organization_id=org_id,
            agent_id=agent.id,
            draft=default_flow(agent.greeting).model_dump(mode="json"),
            draft_revision=1,
        )
        db.add(f)
        db.flush()
    return f


def _versions(db: Session, f: AgentFlow) -> list[dict]:
    rows = db.scalars(
        select(AgentFlowVersion).where(AgentFlowVersion.flow_id == f.id).order_by(AgentFlowVersion.version.desc())
    )
    return [
        {
            "version": v.version,
            "note": v.note,
            "source": v.source,
            "restored_from": v.restored_from,
            "created_at": v.created_at.isoformat(),
            "created_by": str(v.created_by) if v.created_by else None,
            "tests": (v.test_report or {}).get("summary"),
        }
        for v in rows
    ]


def _state(db: Session, agent: Agent, f: AgentFlow) -> dict:
    return {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "revision": f.draft_revision,
        "draft": f.draft,
        "draft_updated_at": f.draft_updated_at.isoformat() if f.draft_updated_at else None,
        "published_version": f.published_version,
        "draft_differs": f.published_version is None or f.draft != _published_graph(db, f),
        "validation": validate(Flow.model_validate(f.draft)).as_dict(),
        "versions": _versions(db, f),
    }


def _published_graph(db: Session, f: AgentFlow) -> dict | None:
    if f.published_version is None:
        return None
    return db.scalar(
        select(AgentFlowVersion.graph).where(
            AgentFlowVersion.flow_id == f.id, AgentFlowVersion.version == f.published_version
        )
    )


@router.get("")
def get_flow(agent_id: uuid.UUID, ctx: Reader, db: DB) -> dict:
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent)
    db.commit()
    return _state(db, agent, f)


@router.post("/validate")
def validate_graph(agent_id: uuid.UUID, body: ValidateIn, ctx: Reader, db: DB) -> dict:
    _agent(db, ctx.org_id, agent_id)
    return validate(parse(body.graph)).as_dict()


@router.put("/draft")
def save_draft(agent_id: uuid.UUID, body: DraftIn, ctx: Writer, db: DB) -> dict:
    """Autosave. Incomplete flows are fine here; only publishing needs a valid flow."""
    agent = _agent(db, ctx.org_id, agent_id)
    flow = parse(body.graph)
    f = _flow(db, ctx.org_id, agent, lock=True)
    if body.base_revision != f.draft_revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"message": "Someone else changed this flow. Reload to see their changes.", "revision": f.draft_revision},
        )
    f.draft = flow.model_dump(mode="json")
    f.draft_revision += 1
    f.draft_updated_at = func.now()
    f.draft_updated_by = ctx.user.id
    db.commit()
    return {"revision": f.draft_revision, "validation": validate(flow).as_dict()}


def _publish(
    db: Session,
    ctx: OrgContext,
    agent: Agent,
    f: AgentFlow,
    graph: dict,
    note: str,
    source: str,
    restored_from: int | None,
    request: Request,
) -> dict:
    flow = Flow.model_validate(graph)
    report = validate(flow)
    if not report.ok:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": "Fix the flow's errors before publishing.", "validation": report.as_dict()},
        )
    nxt = (db.scalar(select(func.max(AgentFlowVersion.version)).where(AgentFlowVersion.flow_id == f.id)) or 0) + 1
    v = AgentFlowVersion(
        organization_id=ctx.org_id,
        flow_id=f.id,
        version=nxt,
        graph=flow.model_dump(mode="json"),
        note=note,
        source=source,
        restored_from=restored_from,
        validation=report.as_dict(),
        created_by=ctx.user.id,
    )
    db.add(v)
    f.published_version = nxt
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "agent_flow.published" if source == "publish" else "agent_flow.rolled_back",
        "agent",
        agent.id,
        {"version": nxt, "restored_from": restored_from, "warnings": report.as_dict()["warnings"]},
        client_meta(request),
    )
    db.commit()
    return {"published_version": nxt, "validation": report.as_dict(), "versions": _versions(db, f)}


@router.post("/publish")
def publish(agent_id: uuid.UUID, body: PublishIn, ctx: Writer, db: DB, request: Request) -> dict:
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent, lock=True)
    if body.base_revision != f.draft_revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": "The draft changed since you looked at it. Review it, then publish.",
                "revision": f.draft_revision,
            },
        )
    return _publish(db, ctx, agent, f, f.draft, body.note, "publish", None, request)


@router.get("/versions/{version}")
def get_version(agent_id: uuid.UUID, version: int, ctx: Reader, db: DB) -> dict:
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent)
    v = db.scalar(select(AgentFlowVersion).where(AgentFlowVersion.flow_id == f.id, AgentFlowVersion.version == version))
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such version")
    return {"version": v.version, "graph": v.graph, "note": v.note, "validation": v.validation, "tests": v.test_report}


@router.post("/versions/{version}/rollback")
def rollback(agent_id: uuid.UUID, version: int, body: RollbackIn, ctx: Writer, db: DB, request: Request) -> dict:
    """Publish an earlier version again (as a new version number). The draft is left alone."""
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent, lock=True)
    v = db.scalar(select(AgentFlowVersion).where(AgentFlowVersion.flow_id == f.id, AgentFlowVersion.version == version))
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such version")
    return _publish(db, ctx, agent, f, v.graph, body.note or f"Rolled back to v{version}", "rollback", version, request)


@router.post("/versions/{version}/restore")
def restore_to_draft(agent_id: uuid.UUID, version: int, ctx: Writer, db: DB) -> dict:
    """Copy an earlier version into the draft to edit it. Nothing is published."""
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent, lock=True)
    v = db.scalar(select(AgentFlowVersion).where(AgentFlowVersion.flow_id == f.id, AgentFlowVersion.version == version))
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such version")
    f.draft = v.graph
    f.draft_revision += 1
    f.draft_updated_at = func.now()
    f.draft_updated_by = ctx.user.id
    db.commit()
    return _state(db, agent, f)


def published_flow(db: Session, org_id: uuid.UUID, agent_id: uuid.UUID) -> tuple[int, Flow] | None:
    """What callers get: the published version, or None if nothing is published yet."""
    f = db.scalar(select(AgentFlow).where(AgentFlow.agent_id == agent_id, AgentFlow.organization_id == org_id))
    if f is None or f.published_version is None:
        return None
    g = _published_graph(db, f)
    return (f.published_version, Flow.model_validate(g)) if g else None


# ---------- simulated conversations ----------


class SessionIn(Strict):
    source: Literal["draft", "published"] = "draft"
    caller_phone: str | None = Field(None, max_length=20)
    fail_tools: bool = False


class TurnIn(Strict):
    text: str = Field(min_length=1, max_length=1000)


def _session(db: Session, org_id: uuid.UUID, agent_id: uuid.UUID, session_id: uuid.UUID) -> FlowSession:
    s = db.scalar(
        select(FlowSession).where(
            FlowSession.id == session_id, FlowSession.organization_id == org_id, FlowSession.agent_id == agent_id
        )
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such conversation")
    return s


def _runtime(db: Session, org_id: uuid.UUID, s: FlowSession) -> engine.Runtime:
    opts = s.state.get("options", {})
    return engine.Runtime(
        db, org_id, s.mode, caller_phone=opts.get("caller_phone"), fail_tools=opts.get("fail_tools", False)
    )


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def start_session(agent_id: uuid.UUID, body: SessionIn, ctx: Reader, db: DB) -> dict:
    """Start a simulated call against the draft or the published version. Nothing it does is saved
    (bookings and hand-overs are validated for real, then rolled back)."""
    agent = _agent(db, ctx.org_id, agent_id)
    f = _flow(db, ctx.org_id, agent)
    if body.source == "published":
        pub = published_flow(db, ctx.org_id, agent_id)
        if pub is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Nothing is published yet")
        version, flow = pub
    else:
        version, flow = None, Flow.model_validate(f.draft)
    report = validate(flow)
    if not report.ok:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": "Fix the flow's errors before testing it.", "validation": report.as_dict()},
        )
    state = engine.new_state()
    state["options"] = {"caller_phone": body.caller_phone, "fail_tools": body.fail_tools}
    s = FlowSession(
        organization_id=ctx.org_id,
        agent_id=agent.id,
        mode="simulation",
        source=body.source,
        version=version,
        graph=flow.model_dump(mode="json"),
        state=copy.deepcopy(state),
        transcript=[],
        created_by=ctx.user.id,
    )
    db.add(s)
    db.flush()
    state["session"] = str(s.id)
    events = engine.Engine(flow, _runtime(db, ctx.org_id, s)).start(state)
    s.state, s.transcript = copy.deepcopy(state), events
    flag_modified(s, "state")
    db.commit()
    return {"session_id": str(s.id), "events": events, "ended": False, "version": version, "source": body.source}


@router.post("/sessions/{session_id}/turn")
def session_turn(agent_id: uuid.UUID, session_id: uuid.UUID, body: TurnIn, ctx: Reader, db: DB) -> dict:
    s = _session(db, ctx.org_id, agent_id, session_id)
    if s.ended:
        raise HTTPException(status.HTTP_409_CONFLICT, "This conversation has ended")
    flow = Flow.model_validate(s.graph)
    state = copy.deepcopy(s.state)
    events = engine.Engine(flow, _runtime(db, ctx.org_id, s)).turn(state, body.text)
    s.state = state
    flag_modified(s, "state")
    s.transcript = [*s.transcript, {"type": "caller", "text": body.text}, *events]
    s.ended, s.outcome = bool(state.get("ended")), state.get("outcome")
    db.commit()
    return {"events": events, "ended": s.ended, "outcome": s.outcome, "node": state.get("node")}


@router.get("/sessions/{session_id}")
def get_session(agent_id: uuid.UUID, session_id: uuid.UUID, ctx: Reader, db: DB) -> dict:
    s = _session(db, ctx.org_id, agent_id, session_id)
    return {
        "session_id": str(s.id),
        "mode": s.mode,
        "source": s.source,
        "version": s.version,
        "transcript": s.transcript,
        "ended": s.ended,
        "outcome": s.outcome,
        "created_at": s.created_at.isoformat(),
    }
