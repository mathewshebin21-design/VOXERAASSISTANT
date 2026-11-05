"""The runtime-role probe fails closed: when the login attempt as the runtime role cannot be completed
(connection timeout, server errors, unexpected driver or Python errors), the migration script stops
without changing the role's password, the schema or the environment claim."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app import platform

BASE = "postgresql://voxera_owner:owner-dev-only@localhost:5432"
OLD_PASSWORD = "what-running-deployments-use"

# Runs scripts/migrate.py in a child process with only the runtime-role probe's login attempt replaced
# by a failure. The owner connection (which passes no connect_args) stays real, so everything else the
# script does is the real thing. argv: <fault> <migrate.py arguments...>
HARNESS = """
import importlib.util
import sys

import psycopg
from sqlalchemy.exc import OperationalError

spec = importlib.util.spec_from_file_location("migrate_under_test", "scripts/migrate.py")
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)

FAULTS = {
    "timeout": lambda: OperationalError("SELECT 1", {}, psycopg.OperationalError("connection timeout expired")),
    "server_busy": lambda: OperationalError(
        "SELECT 1", {}, psycopg.OperationalError("FATAL: remaining connection slots are reserved")
    ),
    "driver_error": lambda: psycopg.InterfaceError("the connection is closed"),
    "unexpected_error": lambda: RuntimeError("unexpected failure"),
}


class FailingProbe:
    def __init__(self, fault):
        self.fault = fault

    def connect(self):
        print("harness: runtime-role probe attempted", flush=True)
        raise FAULTS[self.fault]()

    def dispose(self):
        pass


real_create_engine = migrate.create_engine


def create_engine(url, *args, **kwargs):
    if "connect_args" in kwargs:  # only the runtime-role probe passes connect_args
        return FailingProbe(sys.argv[1])
    return real_create_engine(url, *args, **kwargs)


migrate.create_engine = create_engine
sys.exit(migrate.main(sys.argv[2:]))
"""

FAULTS = ["timeout", "server_busy", "driver_error", "unexpected_error"]
CLAIMS = [["--claim-if-empty"], ["--claim", "--confirm-host", "localhost"]]


def run_script(env: dict, *args: str) -> subprocess.CompletedProcess:
    root = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, "scripts/migrate.py", *args]
    return subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603


def run_with_failing_probe(fault: str, env: dict, *args: str) -> subprocess.CompletedProcess:
    root = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, "-c", HARNESS, fault, *args]
    return subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603


def tables(eng) -> set[str]:
    with eng.connect() as c:
        return set(c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars())


def role_logs_in(role: str, password: str) -> bool:
    eng = create_engine(f"postgresql+psycopg://{role}:{password}@localhost:5432/voxera_build_test")
    try:
        with eng.connect() as c:
            return c.execute(text("SELECT 1")).scalar() == 1
    except Exception:
        return False
    finally:
        eng.dispose()


@pytest.fixture
def fresh_db(owner_engine):
    """An empty database, as a new Neon project would be, with Vercel-style variables for it."""
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("DROP DATABASE IF EXISTS voxera_build_test"))
        c.execute(text("CREATE DATABASE voxera_build_test OWNER voxera_owner"))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VOXERA_", "VERCEL_"))}
    env |= {"DATABASE_URL": f"{BASE}/voxera_build_test", "DATABASE_URL_UNPOOLED": f"{BASE}/voxera_build_test"}
    eng = create_engine(f"{BASE}/voxera_build_test".replace("postgresql://", "postgresql+psycopg://"))
    yield env, eng
    eng.dispose()


@pytest.fixture
def runtime_role(fresh_db, owner_engine):
    """A runtime role that exists and logs in with a password other than the one a run would derive,
    as when running deployments were configured from a different owner password."""
    env, eng = fresh_db
    role = f"voxera_app_failclosed_{os.getpid()}"
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text(f"DO $$ BEGIN CREATE ROLE {role} LOGIN; EXCEPTION WHEN duplicate_object THEN END $$"))
        c.execute(text(f"ALTER ROLE {role} LOGIN PASSWORD '{OLD_PASSWORD}'"))
        c.execute(text(f"GRANT CONNECT ON DATABASE voxera_build_test TO {role}"))
    env["VOXERA_APP_ROLE"] = role  # roles are cluster-wide: never touch the suite's voxera_app
    yield role
    eng.dispose()
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("DROP DATABASE IF EXISTS voxera_build_test WITH (FORCE)"))
        c.execute(text(f"DROP ROLE IF EXISTS {role}"))


@pytest.mark.parametrize("claim", CLAIMS, ids=["claim-if-empty", "claim-confirm-host"])
@pytest.mark.parametrize("fault", FAULTS)
def test_claim_stops_when_the_probe_cannot_complete(fault, claim, fresh_db, runtime_role):
    env, eng = fresh_db
    derived = platform.derive("owner-dev-only", "app-role")
    r = run_with_failing_probe(fault, env, "--env", "staging", *claim)
    out = r.stdout + r.stderr
    assert "runtime-role probe attempted" in r.stdout, out  # the failure really was injected
    assert r.returncode == 3 and "could not be verified" in r.stdout and "not changing the password" in r.stdout, out
    assert tables(eng) == set()  # no schema, no environment marker: nothing was claimed
    assert role_logs_in(runtime_role, OLD_PASSWORD) and not role_logs_in(runtime_role, derived)
    assert "owner-dev-only" not in out and derived not in out  # no secrets printed
    assert "Traceback" not in out


@pytest.mark.parametrize("fault", FAULTS)
def test_check_with_an_unverifiable_probe_changes_nothing(fault, fresh_db, runtime_role):
    env, eng = fresh_db
    r = run_with_failing_probe(fault, env, "--env", "staging", "--check")
    out = r.stdout + r.stderr
    assert "runtime-role probe attempted" in r.stdout, out
    assert r.returncode == 0 and "could not be verified" in r.stdout and "nothing was changed" in r.stdout, out
    assert tables(eng) == set()
    assert role_logs_in(runtime_role, OLD_PASSWORD)


@pytest.mark.parametrize("fault", FAULTS)
def test_upgrade_of_a_claimed_database_stops_when_the_probe_cannot_complete(
    fault, fresh_db, runtime_role, owner_engine
):
    env, eng = fresh_db
    derived = platform.derive("owner-dev-only", "app-role")
    # A claimed database at head, as production will be after the claim.
    r = run_script(env, "--env", "staging", "--claim-if-empty", "--reset-runtime-role")
    assert r.returncode == 0 and "claimed for staging" in r.stdout, r.stdout + r.stderr[-2000:]
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text(f"ALTER ROLE {runtime_role} PASSWORD '{OLD_PASSWORD}'"))  # what running deployments use
    before = tables(eng)

    r = run_with_failing_probe(fault, env, "--env", "staging")
    out = r.stdout + r.stderr
    assert "runtime-role probe attempted" in r.stdout, out
    assert r.returncode == 3 and "not changing the password" in r.stdout, out
    assert tables(eng) == before
    with eng.connect() as c:
        assert c.execute(text("SELECT environment FROM deployment_environment")).scalar() == "staging"
    assert role_logs_in(runtime_role, OLD_PASSWORD) and not role_logs_in(runtime_role, derived)
    assert "owner-dev-only" not in out and derived not in out


# These faults deliberately carry synthetic credentials in both SQL and driver text.
# The real transaction performs each preceding write, so the assertions below also
# prove that the CLI error boundary does not swallow an exception before rollback.
WRITE_FAILURE_HARNESS = """
import importlib.util
import sys

from sqlalchemy.exc import ProgrammingError

spec = importlib.util.spec_from_file_location("migrate_under_test", "scripts/migrate.py")
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)
phase = sys.argv[1]


def fail():
    print("harness: injected write failure at " + phase, flush=True)
    password = migrate.app_role_password()
    raise ProgrammingError(
        "ALTER ROLE voxera_app LOGIN PASSWORD '" + password + "'",
        {},
        RuntimeError("owner connection: " + migrate.migration_owner_url()),
    )


if phase == "role":
    real_ensure = migrate.ensure_runtime_role
    def ensure(c, database):
        real_ensure(c, database)
        fail()
    migrate.ensure_runtime_role = ensure
elif phase == "migration":
    real_upgrade = migrate.command.upgrade
    def upgrade(cfg, revision):
        real_upgrade(cfg, revision)
        fail()
    migrate.command.upgrade = upgrade
elif phase == "claim":
    real_claimed = migrate.deploy_env.claimed
    def claimed(c):
        result = real_claimed(c)
        if result is not None:
            fail()
        return result
    migrate.deploy_env.claimed = claimed
elif phase == "connection":
    def create_engine(*args, **kwargs):
        fail()
    migrate.create_engine = create_engine
else:
    raise AssertionError("unknown harness phase")

sys.exit(migrate.main(sys.argv[2:]))
"""


@pytest.mark.parametrize("phase", ["role", "migration", "claim", "connection"])
def test_write_failures_are_redacted_and_roll_back(phase, fresh_db, runtime_role):
    env, eng = fresh_db
    root = Path(__file__).resolve().parents[1]
    cmd = [
        sys.executable,
        "-c",
        WRITE_FAILURE_HARNESS,
        phase,
        "--env",
        "staging",
        "--claim-if-empty",
        "--reset-runtime-role",
    ]
    r = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603
    out = r.stdout + r.stderr
    assert f"injected write failure at {phase}" in out
    assert r.returncode == 1 and "Error details are suppressed to protect credentials" in out
    assert "Traceback" not in out and "ALTER ROLE" not in out and "owner connection:" not in out
    assert "owner-dev-only" not in out and platform.derive("owner-dev-only", "app-role") not in out
    assert tables(eng) == set()
    assert role_logs_in(runtime_role, OLD_PASSWORD)

