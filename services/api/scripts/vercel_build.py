"""Vercel build step: prepare the attached database, then run migrations as its owner.

1. Ensure the runtime role ``voxera_app`` exists with its derived password (see app/platform.py)
   and may connect. It owns nothing, so row-level security always applies to the API.
2. ``alembic upgrade head`` as the owner, granting the runtime role its table privileges.

With no database attached yet, it skips both and the build still succeeds; the API then
reports not-ready on /readyz until a database is connected and the project redeployed.
"""

import re
import sys

from alembic.config import main as alembic
from sqlalchemy import create_engine, pool, text
from sqlalchemy.engine import make_url

from app.platform import APP_ROLE, app_role_password, hosted_overrides


def main() -> int:
    if not hosted_overrides():
        print("vercel_build: no database attached (DATABASE_URL not set) — skipping migrations.")
        return 0
    from app.config import get_settings

    owner_url = get_settings().migration_database_url
    password = app_role_password()
    assert password and re.fullmatch(r"[0-9a-f]{64}", password)  # hex only: safe to inline in DDL
    db = make_url(owner_url).database
    assert db and re.fullmatch(r"[A-Za-z0-9_-]+", db)
    engine = create_engine(owner_url, poolclass=pool.NullPool)
    with engine.begin() as c:
        exists = c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}).scalar()
        verb = "ALTER" if exists else "CREATE"
        # New roles default to NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS (the test asserts it).
        c.execute(text(f"{verb} ROLE {APP_ROLE} LOGIN PASSWORD '{password}'"))
        c.execute(text(f'GRANT CONNECT ON DATABASE "{db}" TO {APP_ROLE}'))
    engine.dispose()
    print(f"vercel_build: runtime role {APP_ROLE} ready; running migrations.")
    alembic(argv=["-x", f"app_role={APP_ROLE}", "upgrade", "head"])
    print("vercel_build: migrations complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
