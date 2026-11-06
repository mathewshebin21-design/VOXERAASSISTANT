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


def run() -> int:
    """Run the preflight; print only fixed text on failure (driver errors can carry URLs)."""
    try:
        return main()
    except ConfigError as exc:
        # Fixed RC-1 gate text only: it names a gate or a variable, never a value.
        print(f"vercel_build: REFUSING TO DEPLOY: {exc}.")
        return 1
    except Exception:
        # Driver/config exceptions can contain credential-bearing URLs.
        print("vercel_build: REFUSING TO DEPLOY: database preflight failed; inspect configuration and access.")
        return 1


if __name__ == "__main__":
    sys.exit(run())
