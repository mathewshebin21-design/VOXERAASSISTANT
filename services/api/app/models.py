"""ORM models. Every tenant-owned table carries ``organization_id`` and is protected by RLS (see migrations)."""

import enum
import uuid
from datetime import UTC, datetime, time
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSON().with_variant(JSONB(), "postgresql")}


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _org_fk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Role(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    manager = "manager"
    viewer = "viewer"


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = _created()
    __table_args__ = (Index("uq_users_email_lower", func.lower(email), unique=True),)


class AuthSession(Base):
    """A login session (refresh-token family). Revoking it invalidates every token in the family."""

    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class RefreshToken(Base):
    """Single-use refresh tokens. Presenting one that was already used signals theft: the whole session is revoked."""

    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = _pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth_sessions.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = _created()
    memberships: Mapped[list["Membership"]] = relationship(back_populates="organization", passive_deletes=True)


class Membership(Base):
    __tablename__ = "memberships"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[Role] = mapped_column(Enum(Role, name="member_role"), nullable=False)
    created_at: Mapped[datetime] = _created()
    organization: Mapped[Organization] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship()
    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_membership_org_user"),)


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role, name="member_role"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BusinessProfile(Base):
    __tablename__ = "business_profiles"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    sector: Mapped[str] = mapped_column(String(80), default="hair_beauty", nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(320))
    website: Mapped[str | None] = mapped_column(String(300))
    address_line1: Mapped[str | None] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(100))
    postcode: Mapped[str | None] = mapped_column(String(16))
    country: Mapped[str] = mapped_column(String(2), default="GB", nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OfficeHours(Base):
    """Opening intervals. weekday: 0 = Monday … 6 = Sunday (ISO order). A day with no rows is closed."""

    __tablename__ = "office_hours"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    opens_at: Mapped[time] = mapped_column(Time, nullable=False)
    closes_at: Mapped[time] = mapped_column(Time, nullable=False)
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_hours_weekday"),
        CheckConstraint("opens_at < closes_at", name="ck_hours_order"),
    )


class Service(Base):
    __tablename__ = "services"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_from_pence: Mapped[int | None] = mapped_column(Integer)
    bookable_by_agent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    requires_patch_test: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created()
    __table_args__ = (
        CheckConstraint("duration_min BETWEEN 5 AND 600", name="ck_service_duration"),
        CheckConstraint("buffer_min BETWEEN 0 AND 120", name="ck_service_buffer"),
        CheckConstraint("price_from_pence IS NULL OR price_from_pence >= 0", name="ck_service_price"),
        Index("uq_service_org_name", "organization_id", func.lower(name), unique=True),
    )


class WorkspaceSettings(Base):
    __tablename__ = "workspace_settings"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/London", nullable=False)
    locale: Mapped[str] = mapped_column(String(16), default="en-GB", nullable=False)
    recording_disclosure_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    recording_disclosure_text: Mapped[str] = mapped_column(
        String(500), default="This call may be recorded and transcribed to help us improve.", nullable=False
    )
    recording_retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    data_region: Mapped[str] = mapped_column(String(16), default="uk", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    __table_args__ = (CheckConstraint("recording_retention_days BETWEEN 7 AND 365", name="ck_settings_retention"),)


class AgentStatus(str, enum.Enum):
    draft = "draft"
    live = "live"
    paused = "paused"


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[AgentStatus] = mapped_column(
        Enum(AgentStatus, name="agent_status"), default=AgentStatus.draft, nullable=False
    )
    language: Mapped[str] = mapped_column(String(16), default="en-GB", nullable=False)
    voice_id: Mapped[str] = mapped_column(String(60), default="v-en-gb-warm", nullable=False)
    greeting: Mapped[str] = mapped_column(String(500), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AuditLog(Base):
    """Append-only. The API role may only INSERT and SELECT; an UPDATE trigger rejects edits even for the owner."""

    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(60))
    target_id: Mapped[str | None] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = _created()
    __table_args__ = (Index("ix_audit_org_created", "organization_id", "created_at"),)


class UsageKind(str, enum.Enum):
    call_minutes = "call_minutes"
    sms_messages = "sms_messages"
    llm_tokens = "llm_tokens"
    tts_characters = "tts_characters"


class UsageSource(str, enum.Enum):
    live = "live"
    simulated = "simulated"


class UsageEvent(Base):
    """Metered usage. ``source`` keeps simulated activity out of billable totals."""

    __tablename__ = "usage_events"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    kind: Mapped[UsageKind] = mapped_column(Enum(UsageKind, name="usage_kind"), nullable=False)
    source: Mapped[UsageSource] = mapped_column(Enum(UsageSource, name="usage_source"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = _created()
    __table_args__ = (
        UniqueConstraint("organization_id", "idempotency_key", name="uq_usage_idempotency"),
        CheckConstraint("quantity >= 0", name="ck_usage_quantity"),
        Index("ix_usage_org_time", "organization_id", "occurred_at"),
    )


class DeletionReceipt(Base):
    """Minimal, non-personal proof that an organisation or account was deleted (kept after the data is gone)."""

    __tablename__ = "deletion_receipts"
    id: Mapped[uuid.UUID] = _pk()
    subject_type: Mapped[str] = mapped_column(String(20), nullable=False)
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Set client-side: the API role may INSERT receipts but not read them back (no RETURNING).
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(UTC), nullable=False
    )


class VoiceTestSession(Base):
    """Measured metrics from a Voice lab test call. Contains no audio and no transcript text."""

    __tablename__ = "voice_test_sessions"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    client_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    stt_provider: Mapped[str] = mapped_column(String(80), nullable=False)
    brain_provider: Mapped[str] = mapped_column(String(80), nullable=False)
    tts_provider: Mapped[str] = mapped_column(String(80), nullable=False)
    turns: Mapped[list] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    summary: Mapped[dict] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = _created()
    __table_args__ = (
        UniqueConstraint("organization_id", "client_session_id", name="uq_voice_session_client_id"),
        CheckConstraint("duration_ms >= 0", name="ck_voice_duration"),
        Index("ix_voice_sessions_org_time", "organization_id", "started_at"),
    )
