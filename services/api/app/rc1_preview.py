"""Fail-closed, runtime-role-only configuration for the isolated RC-1 Preview."""

import os
from urllib.parse import parse_qs, unquote, urlsplit

BRANCH = "codex/rc1-validation"
HOST = "ep-wandering-hat-zatfukuw.c-2.eu-west-2.aws.neon.tech"
POOLED_HOST = HOST.replace(".c-2.", "-pooler.c-2.")
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
        raise ValueError("RC-1 requires its exact Preview branch, profile and staging identity")
    return True


def _url(name: str, hosts: tuple[str, ...]) -> str:
    value = os.environ.get(name, "")
    try:
        p = urlsplit(value)
        valid = (
            p.scheme in ("postgres", "postgresql", "postgresql+psycopg")
            and p.hostname in hosts
            and p.port in (None, 5432)
            and unquote(p.username or "") == "voxera_app"
            and bool(p.password)
            and p.path == "/neondb"
            and not p.fragment
        )
        query = parse_qs(p.query, keep_blank_values=True)
        valid = valid and query.get("sslmode") in (["require"], ["verify-full"])
        valid = valid and set(query) <= {"sslmode", "channel_binding"}
        if not valid:
            raise ValueError()
    except ValueError:
        raise ValueError(f"RC-1 {name} must use the dedicated database, TLS and voxera_app") from None
    return p._replace(scheme="postgresql+psycopg").geturl()


def configuration() -> dict[str, str] | None:
    if not active():
        return None
    if any(os.environ.get(k) for k in LEGACY_KEYS):
        raise ValueError("RC-1 forbids inherited database credentials and migration overrides")
    if os.environ.get("VOXERA_APP_ROLE", "voxera_app") != "voxera_app":
        raise ValueError("RC-1 requires the restricted runtime role")
    jwt = os.environ.get("VOXERA_JWT_SECRET", "")
    if len(jwt) < 32 or "dev-only" in jwt:
        raise ValueError("RC-1 requires an independent JWT signing secret")
    return {
        "database_url": _url("VOXERA_DATABASE_URL", (HOST, POOLED_HOST)),
        # This is a restricted, direct preflight connection, never an owner credential.
        "migration_database_url": _url("VOXERA_BUILD_DATABASE_URL", (HOST,)),
        "jwt_secret": jwt,
    }
