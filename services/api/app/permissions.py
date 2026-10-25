"""Role-based permissions. Mirrors the role matrix shown in the approved design."""

import enum

from .models import Role


class Perm(str, enum.Enum):
    read = "read"  # calls, transcripts, agents, business data
    knowledge_write = "knowledge_write"
    agent_write = "agent_write"  # create/edit/publish agents
    business_write = "business_write"  # profile, hours, services, settings
    members_manage = "members_manage"
    integrations_manage = "integrations_manage"
    audit_read = "audit_read"
    usage_read = "usage_read"
    usage_write = "usage_write"
    data_export = "data_export"
    org_delete = "org_delete"
    billing = "billing"


_ALL = set(Perm)
ROLE_PERMS: dict[Role, set[Perm]] = {
    Role.owner: _ALL,
    Role.admin: _ALL - {Perm.data_export, Perm.org_delete, Perm.billing},
    Role.manager: {Perm.read, Perm.knowledge_write},
    Role.viewer: {Perm.read},
}


def has_perm(role: Role, perm: Perm) -> bool:
    return perm in ROLE_PERMS[role]
