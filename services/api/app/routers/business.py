"""Business profile, office hours, service catalogue and workspace settings."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from .. import audit
from ..deps import DB, OrgContext, client_meta, require
from ..models import BusinessProfile, OfficeHours, Service, WorkspaceSettings
from ..permissions import Perm
from ..schemas import (
    BusinessProfileIO,
    BusinessProfileOut,
    HoursIn,
    HoursInterval,
    HoursOut,
    ServiceIn,
    ServiceOut,
    ServicePatch,
    SettingsOut,
    SettingsPatch,
)

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["business"])
Reader = Annotated[OrgContext, Depends(require(Perm.read))]
Writer = Annotated[OrgContext, Depends(require(Perm.business_write))]


@router.get("/business-profile", response_model=BusinessProfileOut)
def get_profile(ctx: Reader, db: DB) -> BusinessProfile:
    p = db.get(BusinessProfile, ctx.org_id)
    assert p is not None
    return p


@router.put("/business-profile", response_model=BusinessProfileOut)
def put_profile(body: BusinessProfileIO, ctx: Writer, db: DB, request: Request) -> BusinessProfile:
    p = db.get(BusinessProfile, ctx.org_id)
    assert p is not None
    changed = {k: v for k, v in body.model_dump().items() if getattr(p, k) != v}
    for k, v in changed.items():
        setattr(p, k, v)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "business_profile.updated",
        "business_profile",
        ctx.org_id,
        {"fields": sorted(changed)},
        client_meta(request),
    )
    db.commit()
    return p


def _hours(db: DB, org_id: uuid.UUID) -> HoursOut:
    rows = db.scalars(
        select(OfficeHours)
        .where(OfficeHours.organization_id == org_id)
        .order_by(OfficeHours.weekday, OfficeHours.opens_at)
    )
    return HoursOut(
        intervals=[HoursInterval(weekday=r.weekday, opens_at=r.opens_at, closes_at=r.closes_at) for r in rows]
    )


@router.get("/office-hours", response_model=HoursOut)
def get_hours(ctx: Reader, db: DB) -> HoursOut:
    return _hours(db, ctx.org_id)


@router.put("/office-hours", response_model=HoursOut)
def put_hours(body: HoursIn, ctx: Writer, db: DB, request: Request) -> HoursOut:
    """Replaces the whole week atomically. A weekday with no intervals is closed."""
    db.execute(delete(OfficeHours).where(OfficeHours.organization_id == ctx.org_id))
    db.add_all(OfficeHours(organization_id=ctx.org_id, **i.model_dump()) for i in body.intervals)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "office_hours.replaced",
        "office_hours",
        None,
        {"intervals": len(body.intervals)},
        client_meta(request),
    )
    db.commit()
    return _hours(db, ctx.org_id)


@router.get("/services", response_model=list[ServiceOut])
def list_services(ctx: Reader, db: DB, include_inactive: bool = False) -> list[Service]:
    q = select(Service).where(Service.organization_id == ctx.org_id).order_by(Service.name)
    if not include_inactive:
        q = q.where(Service.active.is_(True))
    return list(db.scalars(q))


def _get_service(db: DB, org_id: uuid.UUID, service_id: uuid.UUID) -> Service:
    s = db.scalar(select(Service).where(Service.id == service_id, Service.organization_id == org_id))
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return s


@router.post("/services", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(body: ServiceIn, ctx: Writer, db: DB, request: Request) -> Service:
    s = Service(organization_id=ctx.org_id, **body.model_dump())
    db.add(s)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A service with this name already exists") from None
    audit.record(
        db, ctx.org_id, ctx.user.id, "service.created", "service", s.id, {"name": s.name}, client_meta(request)
    )
    db.commit()
    return s


@router.get("/services/{service_id}", response_model=ServiceOut)
def get_service(service_id: uuid.UUID, ctx: Reader, db: DB) -> Service:
    return _get_service(db, ctx.org_id, service_id)


@router.patch("/services/{service_id}", response_model=ServiceOut)
def update_service(service_id: uuid.UUID, body: ServicePatch, ctx: Writer, db: DB, request: Request) -> Service:
    s = _get_service(db, ctx.org_id, service_id)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(s, k, v)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A service with this name already exists") from None
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "service.updated",
        "service",
        s.id,
        {"fields": sorted(changes)},
        client_meta(request),
    )
    db.commit()
    return s


@router.delete("/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(service_id: uuid.UUID, ctx: Writer, db: DB, request: Request) -> None:
    s = _get_service(db, ctx.org_id, service_id)
    db.delete(s)
    audit.record(
        db, ctx.org_id, ctx.user.id, "service.deleted", "service", service_id, {"name": s.name}, client_meta(request)
    )
    db.commit()


@router.get("/settings", response_model=SettingsOut)
def get_settings_(ctx: Reader, db: DB) -> WorkspaceSettings:
    s = db.get(WorkspaceSettings, ctx.org_id)
    assert s is not None
    return s


@router.patch("/settings", response_model=SettingsOut)
def patch_settings(body: SettingsPatch, ctx: Writer, db: DB, request: Request) -> WorkspaceSettings:
    s = db.get(WorkspaceSettings, ctx.org_id)
    assert s is not None
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    old = {k: getattr(s, k) for k in changes}
    for k, v in changes.items():
        setattr(s, k, v)
    audit.record(
        db,
        ctx.org_id,
        ctx.user.id,
        "settings.updated",
        "workspace_settings",
        ctx.org_id,
        {"from": old, "to": changes},
        client_meta(request),
    )
    db.commit()
    return s
