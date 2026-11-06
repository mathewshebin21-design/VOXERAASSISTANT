"""Vercel build step for the API: a READ-ONLY preflight. It never changes the database.

Schema changes are made only by ``scripts/migrate.py``, run explicitly for one named
environment (see docs/deployment.md). This build step connects in a read-only transaction
and refuses to deploy (non-zero exit, so Vercel keeps the current deployment) when:

1. the database belongs to another environment: a preview must use the staging database,
   production the production database (see app/deploy_env.py); or
2. the database schema is not at this code's migration head: run the migrations first.

A local build may skip when no database is attached. A hosted build refuses.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, pool, text  # noqa: E402

from app import deploy_env  # noqa: E402
from app.platform import hosted_overrides  # noqa: E402
from app.rc1_preview import ConfigError  # noqa: E402
from app.rc1_preview import active as rc1_active  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    want = deploy_env.expected()
    overrides = hosted_overrides()
    if not overrides:
        if want:
            print("vercel_build: REFUSING TO DEPLOY: missing database configuration.")
            return 1
        print("vercel_build: no database attached (DATABASE_URL not set) — skipping the database preflight.")
        return 0
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    head = ScriptDirectory.from_config(cfg).get_current_head()
    engine = create_engine(
        overrides["migration_database_url"],
        poolclass=pool.NullPool,
        connect_args={"options": "-c default_transaction_read_only=on"},  # this step cannot write
    )
    try:
        with engine.connect() as c:
            if rc1_active():
                restricted = c.execute(text(
                    "SELECT current_user = 'voxera_app' AND NOT rolsuper AND NOT rolbypassrls "
                    "AND current_database() = 'neondb' FROM pg_roles WHERE rolname = current_user"
                )).scalar()
                if not restricted:
                    print("vercel_build: REFUSING TO DEPLOY: RC-1 runtime role is not restricted.")
                    return 1
            problem = deploy_env.mismatch(c)
            has_version = c.execute(text("SELECT to_regclass('public.alembic_version') IS NOT NULL")).scalar()
            rev = c.execute(text("SELECT version_num FROM alembic_version")).scalar() if has_version else None
    finally:
        engine.dispose()
    if problem:
        print(f"vercel_build: REFUSING TO DEPLOY: {problem}. Nothing was changed.")
        return 1
    if rev != head:
        target = want or "<environment>"
        recovery = (
            "Stop and review the isolated RC-1 target; do not run automatic migrations."
            if rc1_active() else f"Run the migrations first: python scripts/migrate.py --env {target}"
        )
        print(
            f"vercel_build: REFUSING TO DEPLOY: database schema is at {rev or 'empty'}, this code needs {head}. "
            f"{recovery}"
        )
        return 1
    print(f"vercel_build: database preflight passed ({want or 'unchecked environment'}, schema at {head}).")
    return 0


# Fixed categories for driver failures. The driver's own message can contain the host,
# user or URL, so only the matching category name (and a SQLSTATE code) is ever printed.
_CATEGORIES = (
    (("password authentication failed",), "authentication failed: wrong password, or the role cannot log in"),
    (("does not exist",), "the database or role does not exist"),
    (("ssl", "channel binding", "channel_binding"), "TLS or channel-binding negotiation failed"),
    (("pg_hba", "not permitted", "too many connections"), "connection not permitted by the server"),
    (("endpoint",), "the Neon endpoint is unavailable (suspended, disabled or wrong)"),
    (
        ("connection refused", "timed out", "timeout", "name or service not known", "could not translate host"),
        "network: host unreachable or not resolvable",
    ),
)
_SQLSTATES = {
    "42501": "permission denied (a required SELECT grant is missing)",
    "42P01": "a required table does not exist",
    "28P01": "authentication failed: wrong password",
    "28000": "authorization failed for this role",
    "3D000": "the database does not exist",
    "25006": "read-only transaction refused the statement",
}


def describe(exc: BaseException) -> str:
    """A fixed, value-free description of a database failure."""
    orig = getattr(exc, "orig", None) or exc
    code = getattr(orig, "sqlstate", None)
    if isinstance(code, str) and len(code) == 5 and code.isalnum():
        return f"SQLSTATE {code}: {_SQLSTATES.get(code, 'database error')}"
    text_ = str(orig).lower()
    for needles, label in _CATEGORIES:
        if any(n in text_ for n in needles):
            return label
    return f"unclassified {type(orig).__name__}"


def run() -> int:
    """Run the preflight; print only fixed text on failure (driver errors can carry URLs)."""
    try:
        return main()
    except ConfigError as exc:
        # Fixed RC-1 gate text only: it names a gate or a variable, never a value.
        print(f"vercel_build: REFUSING TO DEPLOY: {exc}.")
        return 1
    except Exception as exc:
        # Driver/config exceptions can contain credential-bearing URLs: print a category only.
        print(
            "vercel_build: REFUSING TO DEPLOY: database preflight failed "
            f"({describe(exc)}); inspect configuration and access."
        )
        return 1


if __name__ == "__main__":
    sys.exit(run())
