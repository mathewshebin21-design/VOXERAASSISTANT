"""Creating a workspace: organisation, owner membership and default records, in one transaction."""

import uuid

from sqlalchemy.orm import Session

from . import audit
from .db import set_tenant
from .models import BusinessProfile, Membership, Organization, Role, User, WorkspaceSettings


def provision_organization(db: Session, owner: User, name: str, meta: dict | None = None) -> Organization:
    org_id = uuid.uuid4()
    # The RLS context must name the new organisation before its rows are inserted (WITH CHECK policies).
    set_tenant(db, org_id=org_id, user_id=owner.id)
    org = Organization(id=org_id, name=name)
    db.add(org)
    db.flush()
    db.add_all(
        [
            Membership(organization_id=org_id, user_id=owner.id, role=Role.owner),
            BusinessProfile(organization_id=org_id, display_name=name),
            WorkspaceSettings(organization_id=org_id),
        ]
    )
    audit.record(db, org_id, owner.id, "organization.created", "organization", org_id, {"name": name}, meta)
    db.flush()
    return org
