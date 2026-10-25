"""Request/response schemas. Inputs are validated strictly; unknown fields are rejected."""

import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator, model_validator

from .models import AgentStatus, Role, UsageKind, UsageSource

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----


class SignupIn(Strict):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    full_name: Name
    organization_name: Name

    @field_validator("password")
    @classmethod
    def _not_trivial(cls, v: str) -> str:
        if v.strip() != v or len(set(v)) < 5:
            raise ValueError("Password is too simple")
        return v


class LoginIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RefreshIn(Strict):
    refresh_token: str = Field(min_length=20, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"  # noqa: S105 — OAuth token type, not a secret
    expires_in: int


# ---- users & organisations ----


class UserOut(Out):
    id: uuid.UUID
    email: str
    full_name: str
    created_at: datetime


class UserPatch(Strict):
    full_name: Name


class OrgOut(Out):
    id: uuid.UUID
    name: str
    created_at: datetime


class MyOrgOut(BaseModel):
    organization: OrgOut
    role: Role


class OrgCreate(Strict):
    name: Name


class OrgPatch(Strict):
    name: Name


class OrgDeleteIn(Strict):
    confirm_name: str


class AccountDeleteIn(Strict):
    password: str


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: Role
    joined_at: datetime


class MemberPatch(Strict):
    role: Role


class InvitationIn(Strict):
    email: EmailStr
    role: Role = Role.viewer


class InvitationOut(Out):
    id: uuid.UUID
    email: str
    role: Role
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    token: str | None = None  # only populated in development (see Settings.expose_invite_tokens)


class AcceptInvitationIn(Strict):
    token: str = Field(min_length=20, max_length=200)


# ---- business ----


class BusinessProfileIO(Strict):
    display_name: Name
    sector: str = Field("hair_beauty", max_length=80)
    phone: str | None = Field(None, max_length=40, pattern=r"^[+0-9 ()-]{6,40}$")
    email: EmailStr | None = None
    website: str | None = Field(None, max_length=300, pattern=r"^https://")
    address_line1: str | None = Field(None, max_length=200)
    address_line2: str | None = Field(None, max_length=200)
    city: str | None = Field(None, max_length=100)
    postcode: str | None = Field(None, max_length=16)
    country: str = Field("GB", pattern="^[A-Z]{2}$")
    description: str | None = Field(None, max_length=4000)


class BusinessProfileOut(BusinessProfileIO):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


class HoursInterval(Strict):
    weekday: int = Field(ge=0, le=6, description="0 = Monday … 6 = Sunday")
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _order(self) -> "HoursInterval":
        if self.opens_at >= self.closes_at:
            raise ValueError("opens_at must be before closes_at")
        return self


class HoursIn(Strict):
    intervals: list[HoursInterval] = Field(max_length=28)

    @model_validator(mode="after")
    def _no_overlap(self) -> "HoursIn":
        by_day: dict[int, list[HoursInterval]] = {}
        for i in self.intervals:
            by_day.setdefault(i.weekday, []).append(i)
        for day, xs in by_day.items():
            xs.sort(key=lambda x: x.opens_at)
            for a, b in zip(xs, xs[1:], strict=False):
                if b.opens_at < a.closes_at:
                    raise ValueError(f"Overlapping intervals on weekday {day}")
        return self


class HoursOut(BaseModel):
    intervals: list[HoursInterval]


class ServiceIn(Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    category: str | None = Field(None, max_length=60)
    duration_min: int = Field(ge=5, le=600)
    buffer_min: int = Field(0, ge=0, le=120)
    price_from_pence: int | None = Field(None, ge=0, le=10_000_000)
    bookable_by_agent: bool = True
    requires_patch_test: bool = False
    active: bool = True


class ServicePatch(Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    category: str | None = Field(None, max_length=60)
    duration_min: int | None = Field(None, ge=5, le=600)
    buffer_min: int | None = Field(None, ge=0, le=120)
    price_from_pence: int | None = Field(None, ge=0, le=10_000_000)
    bookable_by_agent: bool | None = None
    requires_patch_test: bool | None = None
    active: bool | None = None


class ServiceOut(Out):
    id: uuid.UUID
    name: str
    category: str | None
    duration_min: int
    buffer_min: int
    price_from_pence: int | None
    bookable_by_agent: bool
    requires_patch_test: bool
    active: bool


class SettingsPatch(Strict):
    timezone: str | None = None
    locale: str | None = Field(None, pattern=r"^[a-z]{2}-[A-Z]{2}$")
    recording_disclosure_enabled: bool | None = None
    recording_disclosure_text: str | None = Field(None, min_length=10, max_length=500)
    recording_retention_days: int | None = Field(None, ge=7, le=365)

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is None:
            return v
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown IANA time zone") from None
        return v


class SettingsOut(Out):
    timezone: str
    locale: str
    recording_disclosure_enabled: bool
    recording_disclosure_text: str
    recording_retention_days: int
    data_region: str


# ---- agents ----

AI_DISCLOSURE = r"(?i)\b(AI|automated|virtual assistant)\b"


class AgentIn(Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    language: str = Field("en-GB", pattern=r"^[a-z]{2}-[A-Z]{2}$")
    voice_id: str = Field("v-en-gb-warm", max_length=60)
    greeting: str = Field(
        min_length=10,
        max_length=500,
        pattern=AI_DISCLOSURE,
        description="Must disclose that the caller is speaking to an AI",
    )


class AgentPatch(Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] | None = None
    language: str | None = Field(None, pattern=r"^[a-z]{2}-[A-Z]{2}$")
    voice_id: str | None = Field(None, max_length=60)
    greeting: str | None = Field(None, min_length=10, max_length=500, pattern=AI_DISCLOSURE)
    status: AgentStatus | None = None


class AgentOut(Out):
    id: uuid.UUID
    name: str
    status: AgentStatus
    language: str
    voice_id: str
    greeting: str
    created_by: uuid.UUID | None
    created_at: datetime


# ---- audit & usage ----


class AuditOut(Out):
    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    action: str
    target_type: str | None
    target_id: str | None
    details: dict
    created_at: datetime


class UsageIn(Strict):
    kind: UsageKind
    source: UsageSource
    quantity: Decimal = Field(ge=0, le=Decimal("1000000"), decimal_places=4)
    occurred_at: datetime
    idempotency_key: str = Field(min_length=8, max_length=120)
    reference: str | None = Field(None, max_length=120)

    @field_validator("occurred_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("occurred_at must include a time-zone offset")
        return v


class UsageOut(Out):
    id: uuid.UUID
    kind: UsageKind
    source: UsageSource
    quantity: Decimal
    occurred_at: datetime
    idempotency_key: str
    reference: str | None


class UsageSummary(BaseModel):
    month: str
    live: dict[str, Decimal]
    simulated: dict[str, Decimal]
    event_count: int
