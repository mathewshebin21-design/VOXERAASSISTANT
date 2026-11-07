"""Fail-closed, runtime-role-only configuration for the isolated RC-1 Preview."""

import os
from urllib.parse import parse_qs, unquote, urlsplit

BRANCH = "codex/rc1-validation"
HOST = "ep-wandering-hat-zatfukuw.c-2.eu-west-2.aws.neon.tech"
POOLED_HOST = HOST.replace(".c-2.", "-pooler.c-2.")


class ConfigError(ValueError):
    """An RC-1 refusal whose text is fixed: it names a gate or a variable, never a value."""


LEGACY_KEYS = (
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL_NO_SSL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_DATABASE",
    "PGHOST",
    "PGHOST_UNPOOLED",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "NEON_PROJECT_ID",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "VOXERA_MIGRATION_DATABASE_URL",
)


def active() -> bool:
    profile = os.environ.get("VOXERA_DEPLOYMENT_PROFILE")
    branch = os.environ.get("VERCEL_GIT_COMMIT_REF")
    reserved = branch in (BRANCH, "codex/rc1-runtime-preview")
    if not profile and not reserved:
        return False
    if (
        profile != "rc1-validation"
        or branch != BRANCH
        or os.environ.get("VERCEL_ENV") != "preview"
        or os.environ.get("VOXERA_EXPECT_DB_ENV") != "staging"
    ):
        raise ConfigError("RC-1 requires its exact Preview branch, profile and staging identity")
    return True


def _url(name: str, hosts: tuple[str, ...]) -> str:
    """The validated driver URL, or ConfigError naming the failed rules in fixed words only."""
    value = os.environ.get(name, "")
    failed: list[str] = []
    try:
        if value and (value != value.strip() or value[0] in "'\"" or value[-1] in "'\""):
            failed.append("surrounding whitespace or quotes")
        p = urlsplit(value.strip())
        checks = (
            ("scheme", p.scheme in ("postgres", "postgresql", "postgresql+psycopg")),
            ("host", p.hostname in hosts),
            ("port", p.port in (None, 5432)),
            ("user voxera_app", unquote(p.username or "") == "voxera_app"),
            ("password", bool(p.password)),
            ("path /neondb", p.path == "/neondb"),
            ("no fragment", not p.fragment),
        )
        failed += [rule for rule, ok in checks if not ok]
        query = parse_qs(p.query, keep_blank_values=True)
        if query.get("sslmode") not in (["require"], ["verify-full"]):
            failed.append("sslmode require or verify-full")
        if not set(query) <= {"sslmode", "channel_binding"}:
            failed.append("only sslmode and channel_binding parameters")
    except ValueError:
        failed.append("parseable URL")
    if failed:
        # Fixed rule names only: never any part of the value.
        raise ConfigError(
            f"RC-1 {name} must use the dedicated database, TLS and voxera_app (failed: {', '.join(failed)})"
        )
    return p._replace(scheme="postgresql+psycopg").geturl()


def configuration() -> dict[str, str] | None:
    if not active():
        return None
    if any(os.environ.get(k) for k in LEGACY_KEYS):
        raise ConfigError("RC-1 forbids inherited database credentials and migration overrides")
    if os.environ.get("VOXERA_APP_ROLE", "voxera_app") != "voxera_app":
        raise ConfigError("RC-1 requires the restricted runtime role")
    jwt = os.environ.get("VOXERA_JWT_SECRET", "")
    if len(jwt) < 32 or "dev-only" in jwt:
        raise ConfigError("RC-1 requires an independent JWT signing secret")
    return {
        "database_url": _url("VOXERA_DATABASE_URL", (HOST, POOLED_HOST)),
        # This is a restricted, direct preflight connection, never an owner credential.
        "migration_database_url": _url("VOXERA_BUILD_DATABASE_URL", (HOST,)),
        "jwt_secret": jwt,
    }
