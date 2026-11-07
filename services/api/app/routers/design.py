"""Which of the three interfaces (Command, Atelier, Flow) a workspace and each member uses.

One platform, three presentation modes: this only stores a preference. The owner sets the
workspace default; any member may choose a personal override that affects nobody else.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..models import Role, WorkspaceSettings
from ..permissions import Perm
from ..schemas import Strict

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["design"])
Member = Annotated[OrgContext, Depends(require(Perm.read))]

Design = Literal["command", "atelier", "flow"]
DEFAULT_DESIGN: Design = "atelier"


class DesignOut(BaseModel):
    workspace_default: Design
    my_override: Design | None
    effective: Design
    can_set_default: bool


class DefaultIn(Strict):
    design: Design


class OverrideIn(Strict):
    design: Design | None  # null = follow the workspace default


def _settings(db: DB, ctx: OrgContext) -> WorkspaceSettings | None:
    return db.get(WorkspaceSettings, ctx.org_id)


def _out(db: DB, ctx: OrgContext) -> DesignOut:
    s = _settings(db, ctx)
    default: Design = s.ui_design if s else DEFAULT_DESIGN  # type: ignore[assignment]
    mine: Design | None = ctx.membership.ui_design  # type: ignore[assignment]
    return DesignOut(
        workspace_default=default,
        my_override=mine,
        effective=mine or default,
        can_set_default=ctx.membership.role == Role.owner,
    )


@router.get("/design", response_model=DesignOut)
def get_design(ctx: Member, db: DB) -> DesignOut:
    return _out(db, ctx)


@router.put("/design/default", response_model=DesignOut)
def set_default(body: DefaultIn, ctx: Member, db: DB, request: Request) -> DesignOut:
    """Only the workspace owner changes what everyone sees by default."""
    if ctx.membership.role != Role.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the workspace owner can change the default design")
    s = _settings(db, ctx)
    if s is None:
        s = WorkspaceSettings(organization_id=ctx.org_id)
        db.add(s)
    before = s.ui_design or DEFAULT_DESIGN
    s.ui_design = body.design
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "design.default_changed",
        "workspace_settings",
        None,
        {"from": before, "to": body.design},
        client_meta(request),
    )
    db.commit()
    return _out(db, ctx)


@router.put("/design/me", response_model=DesignOut)
def set_override(body: OverrideIn, ctx: Member, db: DB, request: Request) -> DesignOut:
    """A member's own choice; it never changes anyone else's view."""
    before = ctx.membership.ui_design
    ctx.membership.ui_design = body.design
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "design.override_changed",
        "membership",
        ctx.membership.id,
        {"from": before, "to": body.design},
        client_meta(request),
    )
    db.commit()
    return _out(db, ctx)
