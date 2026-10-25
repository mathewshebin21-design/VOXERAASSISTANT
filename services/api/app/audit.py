"""Audit logging. Every state-changing action in a workspace writes one append-only row."""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog


def record(
    db: Session,
    org_id: uuid.UUID,
    actor: uuid.UUID | None,
    action: str,
    target_type: str | None = None,
    target_id: Any = None,
    details: dict | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            organization_id=org_id,
            actor_user_id=actor,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            details=details or {},
            ip=(meta or {}).get("ip"),
            user_agent=(meta or {}).get("user_agent"),
        )
    )
