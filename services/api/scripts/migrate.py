"""Explicit database migrations for one named environment. The only thing that changes a
hosted database's schema: builds never do (see scripts/vercel_build.py).

    python scripts/migrate.py --env staging --check            # show state, change nothing
    python scripts/migrate.py --env staging                    # prepare runtime role + upgrade to head
    python scripts/migrate.py --env staging --claim --confirm-host <host>   # first run on a new database
    python scripts/migrate.py --env production --downgrade-to 0006 --yes    # roll back the schema

The target is the owner connection in DATABASE_URL_UNPOOLED (or DATABASE_URL), as Vercel's
Neon connection provides it: copy it from the right Vercel environment, or use the GitHub
"db-migrate" workflow, whose secrets are kept per GitHub environment.

Safety:
- every database is claimed for exactly one environment; a run for another environment stops
  before touching anything;
- claiming a new database requires typing its host name back (--confirm-host), so the wrong
  connection string can't be claimed by accident;
- --check never writes;
- before changing the runtime role's password, the run logs in as that role with the password it
  would set. If the role already uses a different password (running deployments derived it from a
  different owner password), it stops: changing it would lock those deployments out. Pass
  --reset-runtime-role only for a deliberate credential rotation.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, pool, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402

from app import deploy_env  # noqa: E402
from app.platform import APP_ROLE, app_role_password, migration_owner_url  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def say(msg: str) -> None:
    print(f"migrate: {msg}", flush=True)


def alembic_config(owner_url: str) -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", owner_url.replace("%", "%%"))
    cfg.cmd_opts = argparse.Namespace(x=[f"app_role={APP_ROLE}"])
    return cfg


def current_revision(conn) -> str | None:
    if not conn.execute(text("SELECT to_regclass('public.alembic_version') IS NOT NULL")).scalar():
        return None
    return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def ensure_runtime_role(c, database: str) -> None:
    password = app_role_password()
    assert password and re.fullmatch(r"[0-9a-f]{64}", password)  # hex only: safe to inline in DDL
    assert re.fullmatch(r"[A-Za-z0-9_-]+", database)
    exists = c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}).scalar()
    verb = "ALTER" if exists else "CREATE"
    # New roles default to NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS.
    c.execute(text(f"{verb} ROLE {APP_ROLE} LOGIN PASSWORD '{password}'"))
    c.execute(text(f'GRANT CONNECT ON DATABASE "{database}" TO {APP_ROLE}'))


ROLE_STATUS = {
    "absent": "does not exist yet; it will be created",
    "match": "already logs in with the password this run would set, so running deployments are unaffected",
    "mismatch": "uses a different password from the one this run would set. Running deployments were "
    "configured from a different owner password, and changing it would lock them out",
    "unknown": "could not be verified (the login attempt failed for another reason)",
}


def runtime_role_status(c, owner_url: str) -> str:
    """Whether the runtime role already has the password this run would give it. Changes nothing:
    one login attempt as that role, on its own connection. Never prints connection details."""
    if not c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}).scalar():
        return "absent"
    as_role = make_url(owner_url).set(username=APP_ROLE, password=app_role_password())
    probe = create_engine(as_role, poolclass=pool.NullPool, connect_args={"connect_timeout": 10})
    try:
        with probe.connect() as p:
            p.execute(text("SELECT 1"))
        return "match"
    except OperationalError as e:
        return "mismatch" if "password authentication failed" in str(e.orig or e) else "unknown"
    finally:
        probe.dispose()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, choices=deploy_env.ENVIRONMENTS)
    ap.add_argument("--check", action="store_true", help="report only; change nothing")
    ap.add_argument("--claim", action="store_true", help="claim an unclaimed database for --env")
    ap.add_argument("--confirm-host", help="the database host, typed back, required with --claim")
    ap.add_argument(
        "--claim-if-empty",
        action="store_true",
        help="claim an unclaimed database without --confirm-host, but only if it has no tables at all "
        "(a brand-new database; an existing database such as production never qualifies)",
    )
    ap.add_argument("--downgrade-to", help="roll the schema back to this revision")
    ap.add_argument("--yes", action="store_true", help="confirm a downgrade")
    ap.add_argument(
        "--reset-runtime-role",
        action="store_true",
        help="set the runtime role's password even if it currently differs (deliberate credential rotation only: "
        "deployments built before the rotation lose database access)",
    )
    a = ap.parse_args(argv)

    owner_url = migration_owner_url()
    if not owner_url:
        say("no database connection (DATABASE_URL_UNPOOLED / DATABASE_URL) in the environment")
        return 2
    url = make_url(owner_url)
    host, database = url.host or "", url.database or ""
    say(f"target {a.env}: host {host}, database {database}")
    cfg = alembic_config(owner_url)
    head = ScriptDirectory.from_config(cfg).get_current_head()

    engine = create_engine(owner_url, poolclass=pool.NullPool)
    try:
        with engine.begin() as c:
            # Hold this transaction through role setup, Alembic and the final claim.
            # The lock also coordinates manual runs outside GitHub Actions.
            if not c.execute(text("SELECT pg_try_advisory_xact_lock(1448040517, 1)")).scalar():
                say("STOP: another migration is running on this database. Retry when it finishes.")
                return 3
            cfg.attributes["connection"] = c
            have = deploy_env.claimed(c)
            rev = current_revision(c)
            empty = not c.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).scalar()
            say(f"claimed for: {have or 'nobody yet'}; schema at {rev or 'empty'}; code head {head}")

            if have is not None and have != a.env:
                say(f"STOP: this database belongs to {have}, not {a.env}. Nothing was changed.")
                return 3
            if have is None and not a.check and not (a.claim_if_empty and empty):
                if not a.claim:
                    say(
                        f"STOP: this database is not claimed yet. If {host} is the {a.env} database, rerun with "
                        f"--claim --confirm-host {host}. Nothing was changed."
                    )
                    return 3
                if a.confirm_host != host:
                    say("STOP: --confirm-host must equal the target host exactly. Nothing was changed.")
                    return 3
            role = runtime_role_status(c, owner_url)
            say(f"runtime role {APP_ROLE}: {ROLE_STATUS[role]}")
            if a.check:
                pending = (
                    []
                    if rev == head
                    else [s.revision for s in ScriptDirectory.from_config(cfg).iterate_revisions(head, rev or "base")][
                        ::-1
                    ]
                )
                say(f"pending migrations: {', '.join(pending) or 'none'} (check only; nothing was changed)")
                return 0

            if a.downgrade_to:
                if not a.yes:
                    say("STOP: a downgrade needs --yes. Nothing was changed.")
                    return 3
                if a.downgrade_to == "base" or (a.downgrade_to.isdigit() and int(a.downgrade_to) < 7):
                    say("note: below 0007 the environment marker is dropped; claim the database again after upgrading")
                command.downgrade(cfg, a.downgrade_to)
                say(f"schema rolled back to {a.downgrade_to}")
                return 0

            if role not in ("absent", "match") and not a.reset_runtime_role:
                say(
                    f"STOP: not changing the password of {APP_ROLE}, because running deployments may depend on it. "
                    "Check that this run's owner connection is the one the deployments use. Nothing was changed."
                )
                return 3
            ensure_runtime_role(c, database)
            say(f"runtime role {APP_ROLE} ready")
            command.upgrade(cfg, "head")
            if have is None:
                c.execute(text("INSERT INTO deployment_environment (id, environment) VALUES (1, :e)"), {"e": a.env})
                say(f"database claimed for {a.env}")
            say(f"done: schema at {current_revision(c)}, claimed for {deploy_env.claimed(c)}")
            return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
