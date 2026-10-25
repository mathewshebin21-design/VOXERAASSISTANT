"""Agents belong to exactly one workspace. Full configuration/versioning arrives in Phase 9."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..models import Agent
from ..permissions import Perm
from ..schemas import AgentIn, AgentOut, AgentPatch

router = APIRouter(prefix="/v1/orgs/{org_id}/agents", tags=["agents"])
Reader = Annotated[OrgContext, Depends(require(Perm.read))]
Writer = Annotated[OrgContext, Depends(require(Perm.agent_write))]


def _get(db: DB, org_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    a = db.scalar(select(Agent).where(Agent.id == agent_id, Agent.organization_id == org_id))
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
    return a


@router.get("", response_model=list[AgentOut])
def list_agents(ctx: Reader, db: DB) -> list[Agent]:
    return list(db.scalars(select(Agent).where(Agent.organization_id == ctx.org_id).order_by(Agent.created_at)))


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
def create_agent(body: AgentIn, ctx: Writer, db: DB, request: Request) -> Agent:
    a = Agent(organization_id=ctx.org_id, created_by=ctx.user.id, **body.model_dump())
    db.add(a)
    db.flush()
    audit.record(db, ctx.org_id, ctx.user.id, "agent.created", "agent", a.id, {"name": a.name}, client_meta(request))
    db.commit()
    return a


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: uuid.UUID, ctx: Reader, db: DB) -> Agent:
    return _get(db, ctx.org_id, agent_id)


@router.patch("/{agent_id}", response_model=AgentOut)
def update_agent(agent_id: uuid.UUID, body: AgentPatch, ctx: Writer, db: DB, request: Request) -> Agent:
    a = _get(db, ctx.org_id, agent_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(a, k, v)
    audit.record(
        db, ctx.org_id, ctx.user.id, "agent.updated", "agent", a.id, {"fields": sorted(changes)}, client_meta(request)
    )
    db.commit()
    return a


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: uuid.UUID, ctx: Writer, db: DB, request: Request) -> None:
    a = _get(db, ctx.org_id, agent_id)
    db.delete(a)
    audit.record(
        db, ctx.org_id, ctx.user.id, "agent.deleted", "agent", agent_id, {"name": a.name}, client_meta(request)
    )
    db.commit()
