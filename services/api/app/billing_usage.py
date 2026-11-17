"""Provider-neutral billing usage records, before database-backed settlement.

Pure validation only: durable uniqueness and transactional limits must be enforced
by the future PostgreSQL ledger, not by in-memory application state.
"""

from dataclasses import dataclass
from enum import StrEnum


class UsageKind(StrEnum):
    CALL_SECOND = "call_second"
    STT_SECOND = "stt_second"
    TTS_CHARACTER = "tts_character"
    LLM_UNIT = "llm_token"
    NOTIFICATION = "notification"


@dataclass(frozen=True)
class UsageEvent:
    organization_id: str
    source_event_id: str
    kind: UsageKind
    units: int
    synthetic: bool
    provider: str

    def __post_init__(self) -> None:
        if not self.organization_id or not self.source_event_id or not self.provider:
            raise ValueError("Tenant, source event ID and provider are required")
        if type(self.units) is not int or self.units <= 0:
            raise ValueError("Usage units must be a positive integer")
        if not isinstance(self.kind, UsageKind):
            raise ValueError("Unknown usage unit")
        if type(self.synthetic) is not bool:
            raise ValueError("Synthetic status must be a boolean")

    @property
    def billable_units(self) -> int:
        return 0 if self.synthetic else self.units

    @property
    def deduplication_key(self) -> tuple[str, str, str]:
        """Scope provider event identity to tenant; enforce this key in the database."""
        return (self.organization_id, self.provider, self.source_event_id)


class UsageReplayConflict(ValueError):
    """An existing event ID was reused with a different immutable payload."""


def reconcile_replay(existing: UsageEvent, incoming: UsageEvent) -> bool:
    """Return False for an exact replay; reject identity reuse with changed payload.

    The database writer must acquire/serialize the unique event identity before
    invoking this check. This pure helper does not provide transactional safety.
    """
    if existing.deduplication_key != incoming.deduplication_key:
        raise ValueError("Cannot reconcile distinct usage identities")
    if existing != incoming:
        raise UsageReplayConflict("Usage event identity reused with conflicting payload")
    return False
