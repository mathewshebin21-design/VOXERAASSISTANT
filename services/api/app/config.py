"""Runtime configuration. Every secret comes from the environment; nothing is hard-coded."""

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # Only for local development/tests: return invitation tokens in API responses instead of emailing them.
    expose_invite_tokens: bool = True
    invitation_days: int = 7

    login_attempts_per_minute: int = 5

    @field_validator("jwt_secret")
    @classmethod
    def _secret_strength(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("VOXERA_JWT_SECRET must be at least 32 characters")
        return v

    def assert_production_safe(self) -> None:
        if self.env == "production":
            if "dev-only" in self.jwt_secret.get_secret_value() or "dev-only" in self.database_url:
                raise RuntimeError("Development credentials must not be used in production")
            if self.expose_invite_tokens:
                raise RuntimeError("expose_invite_tokens must be false in production")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.assert_production_safe()
    return s
