"""Which database a deployment may use.

Every hosted database is claimed once for one environment ("production" or "staging") by
``scripts/migrate.py --claim``, which writes a marker row that the API role can read but
never change. Deployments know which environment they are (Vercel sets ``VERCEL_ENV``):

- a production deployment must find a ``production`` database;
- a preview or development deployment must find a ``staging`` database.

The build (``scripts/vercel_build.py``) refuses to deploy on a mismatch, and the running API
refuses every request except ``/healthz``. So a preview that is pointed at the production
database by mistake can neither change it nor serve its data.
"""

import os

from sqlalchemy import text
from sqlalchemy.engine import Connection

ENVIRONMENTS = ("production", "staging")
BY_VERCEL_ENV = {"production": "production", "preview": "staging", "development": "staging"}


def expected() -> str | None:
    """The database environment this deployment requires, or None outside Vercel (local, tests)."""
    explicit = os.environ.get("VOXERA_EXPECT_DB_ENV")
    if explicit and explicit not in ENVIRONMENTS:
        raise ValueError("VOXERA_EXPECT_DB_ENV must be production or staging")
    vercel_env = os.environ.get("VERCEL_ENV")
    if vercel_env is None and os.environ.get("VERCEL") != "1":
        return explicit or None
    hosted = BY_VERCEL_ENV.get(vercel_env or "")
    if hosted is None:
        raise ValueError("Missing or unsupported VERCEL_ENV on hosted deployment")
    if explicit and explicit != hosted:
        raise ValueError("VOXERA_EXPECT_DB_ENV conflicts with VERCEL_ENV")
    return hosted


def claimed(conn: Connection) -> str | None:
    """The environment this database was claimed for, or None if unclaimed (or not migrated yet)."""
    if not conn.execute(text("SELECT to_regclass('public.deployment_environment') IS NOT NULL")).scalar():
        return None  # migrations not run yet
    return conn.execute(text("SELECT environment FROM deployment_environment WHERE id = 1")).scalar()


def mismatch(conn: Connection) -> str | None:
    """Why this deployment must not use this database, or None if it may."""
    want = expected()
    if want is None:
        return None
    have = claimed(conn)
    if have == want:
        return None
    if have is None:
        return f"this {want} deployment's database has not been claimed for {want} (run scripts/migrate.py)"
    return f"this {want} deployment is connected to the {have} database"
