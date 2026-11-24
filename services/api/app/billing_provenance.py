"""Trusted usage provenance contract for future authenticated ingestion adapters.

Only server-side call records or verified provider adapters may construct this context.
This module performs no payment, call, or external action.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.billing_usage import UsageEvent, UsageKind


class UsageOrigin(StrEnum):
    VERIFIED_PROVIDER = "verified_provider"
    SYNTHETIC_HARNESS = "synthetic_harness"


@dataclass(frozen=True)
class TrustedUsageContext:
    organization_id: str
    provider: str
    origin: UsageOrigin
    authenticated: bool

    def __post_init__(self) -> None:
        if not self.organization_id or not self.provider:
            raise ValueError("Tenant and provider are required")
        if not isinstance(self.origin, UsageOrigin):
            raise ValueError("Unknown usage origin")
        if type(self.authenticated) is not bool or not self.authenticated:
            raise PermissionError("Usage provenance must be authenticated")


def derive_usage_event(
    context: TrustedUsageContext,
    *,
    source_event_id: str,
    kind: UsageKind,
    units: int,
) -> UsageEvent:
    """Derive tenant/provider/synthetic from verified server context, never payload fields."""
    return UsageEvent(
        organization_id=context.organization_id,
        source_event_id=source_event_id,
        kind=kind,
        units=units,
        synthetic=context.origin is UsageOrigin.SYNTHETIC_HARNESS,
        provider=context.provider,
    )
