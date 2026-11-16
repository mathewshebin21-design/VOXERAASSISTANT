"""A workspace's saved voice policy (migration 0012) and the telephone numbers that reach it.

``load`` returns the policy routing uses (``routing.VoicePolicy``); a workspace that never saved
one gets the defaults. ``save`` validates through the same dataclass, so the stored policy can
never be one routing would reject. Both run under the caller's tenant context (row-level security).
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..models import PhoneNumber, VoicePolicyRow
from .languages import LANGUAGES, PROVIDERS
from .routing import VoicePolicy

REGIONS = ("device", "uk", "eu", "us", "global")


class PolicyError(ValueError):
    """The policy is not valid. Safe to show to the workspace owner."""


def load(db: Session, org_id: uuid.UUID) -> VoicePolicy:
    row = db.get(VoicePolicyRow, org_id)
    if row is None:
        return VoicePolicy()
    return VoicePolicy(
        default_language=row.default_language,
        languages=tuple(row.languages),
        fallback_language=row.fallback_language,
        allowed_regions=frozenset(row.allowed_regions),
        blocked_providers=frozenset(row.blocked_providers),
        allow_paid=row.allow_paid,
        allow_unverified=row.allow_unverified,
        prefer=tuple(row.preferred_providers),
    )


def build(
    *,
    default_language: str,
    languages: list[str],
    fallback_language: str | None,
    allowed_regions: list[str],
    blocked_providers: list[str],
    preferred_providers: list[str],
    allow_paid: bool,
    allow_unverified: bool,
) -> VoicePolicy:
    """A validated policy from user input. Unknown languages, regions or providers are refused."""
    unknown = {default_language, *languages, *([fallback_language] if fallback_language else [])} - LANGUAGES.keys()
    if unknown:
        raise PolicyError(f"Unknown language: {', '.join(sorted(unknown))}")
    if len(set(languages)) != len(languages):
        raise PolicyError("Each language may be listed once")
    if not allowed_regions or set(allowed_regions) - set(REGIONS):
        raise PolicyError("Allowed regions must be one or more of: " + ", ".join(REGIONS))
    bad = (set(blocked_providers) | set(preferred_providers)) - PROVIDERS.keys()
    if bad:
        raise PolicyError(f"Unknown provider: {', '.join(sorted(bad))}")
    if set(blocked_providers) & set(preferred_providers):
        raise PolicyError("A provider cannot be both blocked and preferred")
    try:
        return VoicePolicy(
            default_language=default_language,
            languages=tuple(languages),
            fallback_language=fallback_language,
            allowed_regions=frozenset(allowed_regions),
            blocked_providers=frozenset(blocked_providers),
            allow_paid=allow_paid,
            allow_unverified=allow_unverified,
            prefer=tuple(preferred_providers),
        )
    except ValueError as e:
        raise PolicyError(str(e)) from None


def save(db: Session, org_id: uuid.UUID, user_id: uuid.UUID | None, policy: VoicePolicy) -> None:
    values = {
        "default_language": policy.default_language,
        "languages": list(policy.languages),
        "fallback_language": policy.fallback_language,
        "allowed_regions": sorted(policy.allowed_regions),
        "blocked_providers": sorted(policy.blocked_providers),
        "preferred_providers": list(policy.prefer),
        "allow_paid": policy.allow_paid,
        "allow_unverified": policy.allow_unverified,
        "updated_by": user_id,
    }
    stmt = insert(VoicePolicyRow).values(organization_id=org_id, **values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[VoicePolicyRow.organization_id],
        set_={**values, "updated_at": func.now()},
    )
    db.execute(stmt)
    db.expire_all()


def as_dict(policy: VoicePolicy, saved: bool) -> dict:
    return {
        "saved": saved,  # False: the workspace uses the defaults
        "default_language": policy.default_language,
        "languages": list(policy.languages),
        "fallback_language": policy.fallback_language,
        "allowed_regions": sorted(policy.allowed_regions),
        "blocked_providers": sorted(policy.blocked_providers),
        "preferred_providers": list(policy.prefer),
        "allow_paid": policy.allow_paid,
        "allow_unverified": policy.allow_unverified,
    }


def numbers(db: Session, org_id: uuid.UUID) -> list[PhoneNumber]:
    q = select(PhoneNumber).where(PhoneNumber.organization_id == org_id).order_by(PhoneNumber.e164)
    return list(db.scalars(q))


def owns_active_number(db: Session, org_id: uuid.UUID, e164: str) -> bool:
    """True if the number is active for this workspace. Row-level security means another
    workspace's number is simply not visible, so the answer never reveals who owns it."""
    n = db.scalar(
        select(PhoneNumber.id).where(
            PhoneNumber.organization_id == org_id, PhoneNumber.e164 == e164, PhoneNumber.status == "active"
        )
    )
    return n is not None
