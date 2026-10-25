"""Users, organisations, memberships, invitations, data export and deletion."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import set_tenant
from ..deps import DB, CurrentPrincipal, OrgContext, client_meta, require
from ..models import (
    Agent,
    AuditLog,
    AuthSession,
    BusinessProfile,
    DeletionReceipt,
    Invitation,
    Membership,
    OfficeHours,
    Organization,
    Role,
    Service,
    UsageEvent,
    User,
    WorkspaceSettings,
)
from ..permissions import Perm, has_perm
from ..provisioning import provision_organization
from ..schemas import (
    AcceptInvitationIn,
    AccountDeleteIn,
    InvitationIn,
    InvitationOut,
    MemberOut,
    MemberPatch,
    MyOrgOut,
    OrgCreate,
    OrgDeleteIn,
    OrgOut,
    OrgPatch,
    UserOut,
    UserPatch,
)
from ..security import new_opaque_token, token_digest, verify_password

router = APIRouter(prefix="/v1", tags=["organisations"])


# ---------- me ----------


@router.get("/me", response_model=UserOut)
def me(principal: CurrentPrincipal) -> User:
    return principal.user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserPatch, principal: CurrentPrincipal, db: DB) -> User:
    principal.user.full_name = body.full_name
    db.commit()
    return principal.user


@router.get("/me/organizations", response_model=list[MyOrgOut])
def my_orgs(principal: CurrentPrincipal, db: DB) -> list[MyOrgOut]:
    rows = db.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == principal.user.id)
        .order_by(Organization.created_at)
    ).all()
    return [MyOrgOut(organization=OrgOut.model_validate(o), role=r) for o, r in rows]


@router.get("/me/export")
def export_me(principal: CurrentPrincipal, db: DB) -> dict:
    """Personal data held about the signed-in user (UK GDPR right of access)."""
    u = principal.user
    sessions = db.scalars(select(AuthSession).where(AuthSession.user_id == u.id)).all()
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "user": {"id": str(u.id), "email": u.email, "full_name": u.full_name, "created_at": u.created_at.isoformat()},
        "memberships": [m.model_dump(mode="json") for m in my_orgs(principal, db)],
        "sessions": [
            {
                "created_at": s.created_at.isoformat(),
                "revoked_at": s.revoked_at.isoformat() if s.revoked_at else None,
                "user_agent": s.user_agent,
            }
            for s in sessions
        ],
    }


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: AccountDeleteIn, principal: CurrentPrincipal, db: DB) -> None:
    """Delete the account. Workspaces where the user is the only member are deleted too;
    if the user is the last owner of a workspace that has other members, ownership must be transferred first."""
    u = principal.user
    if not verify_password(body.password, u.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password is incorrect")
    memberships = db.scalars(select(Membership).where(Membership.user_id == u.id)).all()
    solo_orgs: list[uuid.UUID] = []
    for m in memberships:
        set_tenant(db, org_id=m.organization_id)
        members = db.scalar(
            select(func.count()).select_from(Membership).where(Membership.organization_id == m.organization_id)
        )
        owners = db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.organization_id == m.organization_id, Membership.role == Role.owner)
        )
        if members == 1:
            solo_orgs.append(m.organization_id)
        elif m.role == Role.owner and owners == 1:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Transfer ownership of your shared workspaces before deleting your account"
            )
    for org_id in solo_orgs:
        _delete_org(db, org_id, u.id)
    for m in memberships:
        if m.organization_id not in solo_orgs:
            set_tenant(db, org_id=m.organization_id)
            audit.record(db, m.organization_id, u.id, "member.account_deleted", "user", u.id)
    db.add(DeletionReceipt(subject_type="user", subject_id=u.id, requested_by=u.id))
    db.delete(u)
    db.commit()


# ---------- organisations ----------


@router.post("/orgs", response_model=OrgOut, status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreate, principal: CurrentPrincipal, db: DB, request: Request) -> Organization:
    org = provision_organization(db, principal.user, body.name, client_meta(request))
    db.commit()
    return org


@router.get("/orgs/{org_id}", response_model=OrgOut)
def get_org(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> Organization:
    org = db.get(Organization, ctx.org_id)
    assert org is not None
    return org


@router.patch("/orgs/{org_id}", response_model=OrgOut)
def rename_org(
    body: OrgPatch, ctx: Annotated[OrgContext, Depends(require(Perm.business_write))], db: DB, request: Request
) -> Organization:
    org = db.get(Organization, ctx.org_id)
    assert org is not None
    old, org.name = org.name, body.name
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "organization.renamed",
        "organization",
        org.id,
        {"from": old, "to": body.name},
        client_meta(request),
    )
    db.commit()
    return org


def _delete_org(db: Session, org_id: uuid.UUID, actor: uuid.UUID) -> None:
    set_tenant(db, org_id=org_id)
    org = db.get(Organization, org_id)
    if org is None:
        return
    # Child rows (including the append-only audit log) are removed by ON DELETE CASCADE,
    # which runs with the table owner's rights; the API role itself cannot delete audit rows.
    db.delete(org)
    db.add(DeletionReceipt(subject_type="organization", subject_id=org_id, requested_by=actor))
    db.flush()


@router.delete("/orgs/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_org(body: OrgDeleteIn, ctx: Annotated[OrgContext, Depends(require(Perm.org_delete))], db: DB) -> None:
    org = db.get(Organization, ctx.org_id)
    assert org is not None
    if body.confirm_name != org.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type the workspace name exactly to confirm deletion")
    _delete_org(db, ctx.org_id, ctx.user.id)
    db.commit()


@router.get("/orgs/{org_id}/export")
def export_org(ctx: Annotated[OrgContext, Depends(require(Perm.data_export))], db: DB, request: Request) -> dict:
    """Machine-readable export of everything stored for the workspace."""
    oid = ctx.org_id

    def rows(model: type, *order) -> list[dict]:
        out = []
        for r in db.scalars(select(model).where(model.organization_id == oid).order_by(*order)).all():
            out.append({c.name: _json(getattr(r, c.key)) for c in model.__table__.columns})
        return out

    org = db.get(Organization, oid)
    assert org is not None
    members = [m.model_dump(mode="json") for m in list_members(ctx, db)]
    data = {
        "exported_at": datetime.now(UTC).isoformat(),
        "organization": {"id": str(org.id), "name": org.name, "created_at": org.created_at.isoformat()},
        "members": members,
        "business_profile": rows(BusinessProfile),
        "workspace_settings": rows(WorkspaceSettings),
        "office_hours": rows(OfficeHours, OfficeHours.weekday, OfficeHours.opens_at),
        "services": rows(Service, Service.created_at),
        "agents": rows(Agent, Agent.created_at),
        "invitations": [
            {k: v for k, v in r.items() if k != "token_hash"} for r in rows(Invitation, Invitation.created_at)
        ],
        "usage_events": rows(UsageEvent, UsageEvent.occurred_at),
        "audit_logs": rows(AuditLog, AuditLog.created_at),
    }
    audit.record(db, oid, ctx.user.id, "organization.exported", "organization", oid, None, client_meta(request))
    db.commit()
    return data


def _json(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "value"):
        return v.value
    if v.__class__.__name__ == "Decimal":
        return str(v)
    return v


# ---------- members ----------


@router.get("/orgs/{org_id}/members", response_model=list[MemberOut])
def list_members(ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB) -> list[MemberOut]:
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == ctx.org_id)
        .order_by(Membership.created_at)
    ).all()
    return [
        MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role, joined_at=m.created_at)
        for m, u in rows
    ]


def _owner_count(db: Session, org_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.organization_id == org_id, Membership.role == Role.owner)
        )
        or 0
    )


def _target_membership(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> Membership:
    m = db.scalar(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return m


@router.patch("/orgs/{org_id}/members/{user_id}", response_model=MemberOut)
def change_role(
    user_id: uuid.UUID,
    body: MemberPatch,
    ctx: Annotated[OrgContext, Depends(require(Perm.members_manage))],
    db: DB,
    request: Request,
) -> MemberOut:
    m = _target_membership(db, ctx.org_id, user_id)
    actor_is_owner = ctx.membership.role == Role.owner
    if (body.role == Role.owner or m.role == Role.owner) and not actor_is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can grant or remove the owner role")
    if m.role == Role.owner and body.role != Role.owner and _owner_count(db, ctx.org_id) == 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A workspace must keep at least one owner")
    old, m.role = m.role, body.role
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "member.role_changed",
        "user",
        user_id,
        {"from": old.value, "to": body.role.value},
        client_meta(request),
    )
    db.commit()
    u = db.get(User, user_id)
    assert u is not None
    return MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role, joined_at=m.created_at)


@router.delete("/orgs/{org_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(Perm.read))], db: DB, request: Request
) -> None:
    """Admins/owners may remove others; anyone may leave (remove themselves)."""
    self_leave = user_id == ctx.user.id
    if not self_leave and not has_perm(ctx.membership.role, Perm.members_manage):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot remove members")
    m = _target_membership(db, ctx.org_id, user_id)
    if m.role == Role.owner and not self_leave and ctx.membership.role != Role.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can remove an owner")
    if m.role == Role.owner and _owner_count(db, ctx.org_id) == 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A workspace must keep at least one owner")
    db.delete(m)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "member.left" if self_leave else "member.removed",
        "user",
        user_id,
        None,
        client_meta(request),
    )
    db.commit()


# ---------- invitations ----------


@router.post("/orgs/{org_id}/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def invite(
    body: InvitationIn, ctx: Annotated[OrgContext, Depends(require(Perm.members_manage))], db: DB, request: Request
) -> InvitationOut:
    if body.role == Role.owner and ctx.membership.role != Role.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can invite another owner")
    email = body.email.lower()
    existing = db.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == ctx.org_id, func.lower(User.email) == email)
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "That person is already a member")
    token = new_opaque_token()
    inv = Invitation(
        organization_id=ctx.org_id,
        email=email,
        role=body.role,
        token_hash=token_digest(token),
        invited_by=ctx.user.id,
        expires_at=datetime.now(UTC) + timedelta(days=get_settings().invitation_days),
    )
    db.add(inv)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "invitation.created",
        "invitation",
        None,
        {"email": email, "role": body.role.value},
        client_meta(request),
    )
    db.commit()
    out = InvitationOut.model_validate(inv)
    # In production the token is emailed (Phase 8) and never returned by the API.
    out.token = token if get_settings().expose_invite_tokens else None
    return out


@router.get("/orgs/{org_id}/invitations", response_model=list[InvitationOut])
def list_invitations(ctx: Annotated[OrgContext, Depends(require(Perm.members_manage))], db: DB) -> list[Invitation]:
    return list(
        db.scalars(
            select(Invitation).where(Invitation.organization_id == ctx.org_id).order_by(Invitation.created_at.desc())
        )
    )


@router.delete("/orgs/{org_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: uuid.UUID,
    ctx: Annotated[OrgContext, Depends(require(Perm.members_manage))],
    db: DB,
    request: Request,
) -> None:
    inv = db.scalar(select(Invitation).where(Invitation.id == invitation_id, Invitation.organization_id == ctx.org_id))
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    inv.revoked_at = datetime.now(UTC)
    audit.record(db, ctx.org_id, ctx.user.id, "invitation.revoked", "invitation", inv.id, None, client_meta(request))
    db.commit()


@router.post("/invitations/accept", response_model=MyOrgOut)
def accept_invitation(body: AcceptInvitationIn, principal: CurrentPrincipal, db: DB, request: Request) -> MyOrgOut:
    digest = token_digest(body.token)
    # RLS lets an unauthenticated-to-the-org user see exactly one invitation: the one whose token they hold.
    set_tenant(db, invite_hash=digest)
    found = db.execute(select(Invitation.id, Invitation.organization_id).where(Invitation.token_hash == digest)).first()
    if found is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invitation is invalid or has expired")
    # Locking (FOR UPDATE) is subject to the UPDATE policy, so switch into the workspace first.
    set_tenant(db, org_id=found.organization_id)
    inv = db.scalar(select(Invitation).where(Invitation.id == found.id).with_for_update())
    now = datetime.now(UTC)
    if inv is None or inv.revoked_at or inv.accepted_at or inv.expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invitation is invalid or has expired")
    if inv.email != principal.user.email.lower():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This invitation was sent to a different email address")
    if db.scalar(
        select(Membership).where(
            Membership.organization_id == inv.organization_id, Membership.user_id == principal.user.id
        )
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "You are already a member")
    db.add(Membership(organization_id=inv.organization_id, user_id=principal.user.id, role=inv.role))
    inv.accepted_at = now
    audit.record(
        db,
        inv.organization_id,
        principal.user.id,
        "invitation.accepted",
        "invitation",
        inv.id,
        {"role": inv.role.value},
        client_meta(request),
    )
    db.commit()
    org = db.get(Organization, inv.organization_id)
    assert org is not None
    return MyOrgOut(organization=OrgOut.model_validate(org), role=inv.role)
