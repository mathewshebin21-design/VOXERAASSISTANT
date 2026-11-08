"""Authentication for the voice worker's endpoints (/v1/worker/..., ADR-0005 §3).

A worker token names one workspace, a mode (test | live) and a channel (simulated | phone). The
workspace always comes from the token, never from the request. Live mode is refused until the
business's country has passed its launch review, so a worker cannot reach real callers early.
Every worker endpoint is 404 unless worker credentials are enabled.
"""

import uuid
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from . import worker_auth
from .db import set_tenant
from .deps import DB
from .models import Organization, WorkspaceSettings
from .voice import launch
from .voice.regions import country_of


@dataclass(frozen=True)
class WorkerContext:
    org_id: uuid.UUID
    mode: str  # test | live
    channel: str  # simulated | phone


def worker_context(request: Request, db: DB) -> WorkerContext:
    if not worker_auth.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Worker token required")
    try:
        org_id, mode, channel = worker_auth.read(header[7:].strip())
    except worker_auth.WorkerAuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e)) from None
    set_tenant(db, org_id=org_id)
    if db.get(Organization, org_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation not found")
    if mode == "live":  # real callers only where the business's country passed its launch review
        ws = db.get(WorkspaceSettings, org_id)
        country = country_of(ws.locale if ws else None) or ""
        if not launch.ready(country):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Live calls are not enabled for this country yet")
    return WorkerContext(org_id, mode, channel)
