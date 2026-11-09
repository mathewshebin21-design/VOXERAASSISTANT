"""Runtime configuration. Every secret comes from the environment; nothing is hard-coded."""

import os
from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .platform import hosted_overrides
from .rc1_preview import active as rc1_active


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOXERA_", env_file=".env", extra="ignore")

    env: str = Field("development", pattern="^(development|test|production)$")
    # Runtime connections use the non-owner role so Postgres row-level security applies.
    database_url: str = "postgresql+psycopg://voxera_app:app-dev-only@localhost:5432/voxera"
    # Migrations run as the table owner.
    migration_database_url: str = "postgresql+psycopg://voxera_owner:owner-dev-only@localhost:5432/voxera"

    jwt_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    # Signs voice-worker tokens (app/worker_auth.py). Unset = the worker endpoint does not exist.
    worker_secret: SecretStr | None = None
    jwt_issuer: str = "voxera-api"
    jwt_audience: str = "voxera-app"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    cors_origins: list[str] = ["http://localhost:3000"]
    # Until an email service is connected, the one-time invitation link is returned to the
    # inviter (an owner/admin) to share themselves. Set to false once invitations are emailed.
    expose_invite_tokens: bool = True
    invitation_days: int = 7

    login_attempts_per_minute: int = 5  # per email and client address, per minute
    # Per email whatever the address, so rotating addresses cannot multiply the attempts.
    login_attempts_per_email: int = 10
    login_email_window_seconds: int = Field(900, ge=60, le=86400)
    # The request header that carries the real client address, set by our hosting platform and
    # never by the caller. Unset: on Vercel (VERCEL=1) it is x-vercel-forwarded-for, which Vercel
    # writes itself; elsewhere the socket address is used and no header is trusted.
    client_ip_header: str | None = Field(None, pattern=r"^[a-z0-9-]{1,64}$")
    # Where rate-limit counts live. "postgres" is shared by every instance (migration 0010);
    # "memory" is per process and only correct with one instance: the rollback setting.
    rate_limit_backend: str = Field("postgres", pattern="^(postgres|memory)$")

    # ---- live AI and speech providers (Phase 3) ----
    # Nothing here is called unless BOTH a key and a non-zero monthly cap are set.
    # Keys are read only on the server and never returned by any endpoint.
    # Which language model answers: Anthropic's Claude (default), or any provider with an
    # OpenAI-compatible chat API — Groq, Google Gemini, OpenRouter, a local Ollama (e.g. Qwen),
    # or another endpoint given by llm_base_url. See docs/phase-3-live-providers.md.
    llm_provider: str = Field("anthropic", pattern="^(anthropic|groq|gemini|openrouter|ollama|openai_compatible)$")
    anthropic_api_key: SecretStr | None = None
    # Key for the non-Anthropic providers (Ollama needs none).
    llm_api_key: SecretStr | None = None
    # Overrides the provider's usual address (required for openai_compatible).
    llm_base_url: str | None = None
    # Required for non-Anthropic providers, since model names change often; Claude defaults below.
    llm_model: str | None = None
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

    @field_validator("worker_secret")
    @classmethod
    def _worker_secret_strength(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None and len(v.get_secret_value()) < 32:
            raise ValueError("VOXERA_WORKER_SECRET must be at least 32 characters")
        return v

    @property
    def model(self) -> str | None:
        """The model to call: the one configured, or Claude's default for Anthropic."""
        return self.llm_model or ("claude-opus-5-5" if self.llm_provider == "anthropic" else None)

    def assert_production_safe(self) -> None:
        dev = "dev-only" in self.jwt_secret.get_secret_value() or "dev-only" in self.database_url
        if self.env == "production" and dev:
            raise RuntimeError("Development credentials must not be used in production")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # On a host that attaches a Postgres database (Vercel + Neon), fill in anything not set explicitly.
    for key, value in hosted_overrides().items():
        if rc1_active() or f"VOXERA_{key.upper()}" not in os.environ:
            setattr(s, key, SecretStr(value) if key == "jwt_secret" else value)
    s.assert_production_safe()
    return s
