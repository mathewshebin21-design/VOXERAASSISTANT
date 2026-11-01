"""Runtime configuration. Every secret comes from the environment; nothing is hard-coded."""

import os
from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .platform import hosted_overrides


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOXERA_", env_file=".env", extra="ignore")

    env: str = Field("development", pattern="^(development|test|production)$")
    # Runtime connections use the non-owner role so Postgres row-level security applies.
    database_url: str = "postgresql+psycopg://voxera_app:app-dev-only@localhost:5432/voxera"
    # Migrations run as the table owner.
    migration_database_url: str = "postgresql+psycopg://voxera_owner:owner-dev-only@localhost:5432/voxera"

    jwt_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    jwt_issuer: str = "voxera-api"
    jwt_audience: str = "voxera-app"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    cors_origins: list[str] = ["http://localhost:3000"]
    # Until an email service is connected, the one-time invitation link is returned to the
    # inviter (an owner/admin) to share themselves. Set to false once invitations are emailed.
    expose_invite_tokens: bool = True
    invitation_days: int = 7

    login_attempts_per_minute: int = 5

    # ---- live AI and speech providers (Phase 3) ----
    # Nothing here is called unless BOTH a key and a non-zero monthly cap are set.
    # Keys are read only on the server and never returned by any endpoint.
    anthropic_api_key: SecretStr | None = None
    llm_model: str = "claude-opus-5-5"
    llm_effort: str = Field("low", pattern="^(low|medium|high|xhigh|max)$")
    llm_max_output_tokens: int = Field(400, ge=64, le=4000)
    elevenlabs_api_key: SecretStr | None = None
    elevenlabs_voice_id: str | None = None
    elevenlabs_model: str = "eleven_flash_v2_5"
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    # Monthly caps (UTC calendar month). 0 disables that provider. Per workspace and across all workspaces.
    live_llm_tokens_per_org_month: int = Field(0, ge=0)
    live_llm_tokens_global_month: int = Field(0, ge=0)
    live_tts_chars_per_org_month: int = Field(0, ge=0)
    live_tts_chars_global_month: int = Field(0, ge=0)

    @field_validator("jwt_secret")
    @classmethod
    def _secret_strength(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("VOXERA_JWT_SECRET must be at least 32 characters")
        return v

    def assert_production_safe(self) -> None:
        dev = "dev-only" in self.jwt_secret.get_secret_value() or "dev-only" in self.database_url
        if self.env == "production" and dev:
            raise RuntimeError("Development credentials must not be used in production")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # On a host that attaches a Postgres database (Vercel + Neon), fill in anything not set explicitly.
    for key, value in hosted_overrides().items():
        if f"VOXERA_{key.upper()}" not in os.environ:
            setattr(s, key, SecretStr(value) if key == "jwt_secret" else value)
    s.assert_production_safe()
    return s
