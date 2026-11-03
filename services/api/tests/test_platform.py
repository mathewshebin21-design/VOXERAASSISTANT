"""Hosted (Vercel + Neon) configuration and the build-time database bootstrap."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from sqlalchemy import create_engine, text

from app import platform
from app.config import Settings, get_settings


def build(env: dict) -> subprocess.CompletedProcess:
    root = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, "scripts/vercel_build.py"]
    return subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603


POOLED = "postgresql://neondb_owner:s3cr%2Ft@ep-x-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require"
DIRECT = "postgresql://neondb_owner:s3cr%2Ft@ep-x.eu-west-2.aws.neon.tech/neondb?sslmode=require"


def test_overrides_from_neon_variables(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", POOLED)
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", DIRECT)
    o = platform.hosted_overrides()
    run = urlsplit(o["database_url"])
    assert run.scheme == "postgresql+psycopg" and run.username == "voxera_app"
    assert run.hostname == "ep-x-pooler.eu-west-2.aws.neon.tech" and run.query == "sslmode=require"
    assert run.password == platform.derive("s3cr/t", "app-role") != o["jwt_secret"]
    mig = urlsplit(o["migration_database_url"])
    assert mig.username == "neondb_owner" and mig.hostname == "ep-x.eu-west-2.aws.neon.tech"
    assert len(o["jwt_secret"]) == 64 and "s3cr" not in o["jwt_secret"]


def test_no_overrides_without_a_database(monkeypatch):
    for k in ("DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"):
        monkeypatch.delenv(k, raising=False)
    assert platform.hosted_overrides() == {}


def test_explicit_settings_win_and_production_is_safe(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", POOLED)
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", DIRECT)
    monkeypatch.setenv("VOXERA_ENV", "production")
    monkeypatch.delenv("VOXERA_JWT_SECRET", raising=False)
    monkeypatch.setenv("VOXERA_DATABASE_URL", "postgresql+psycopg://explicit:pw@db/x")
    get_settings.cache_clear()
    try:
        s = get_settings()
        assert s.database_url == "postgresql+psycopg://explicit:pw@db/x"  # explicit wins
        assert s.jwt_secret.get_secret_value() == platform.derive("s3cr/t", "jwt")  # derived, not the dev default
    finally:
        get_settings.cache_clear()
    assert Settings(env="production").env == "production"


BASE = "postgresql://voxera_owner:owner-dev-only@localhost:5432"


def run(script: str, env: dict, *args: str) -> subprocess.CompletedProcess:
    root = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, f"scripts/{script}", *args]
    return subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603


@pytest.fixture
def fresh_db(owner_engine):
    """An empty database, as a new Neon project would be, with Vercel-style variables for it."""
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("DROP DATABASE IF EXISTS voxera_build_test"))
        c.execute(text("CREATE DATABASE voxera_build_test OWNER voxera_owner"))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VOXERA_", "VERCEL_"))}
    env |= {"DATABASE_URL": f"{BASE}/voxera_build_test", "DATABASE_URL_UNPOOLED": f"{BASE}/voxera_build_test"}
    env["VOXERA_APP_ROLE"] = "voxera_app_buildtest"  # roles are cluster-wide: don't touch the suite's voxera_app
    eng = create_engine(f"{BASE}/voxera_build_test".replace("postgresql://", "postgresql+psycopg://"))
    yield env, eng
    eng.dispose()


def tables(eng) -> set[str]:
    with eng.connect() as c:
        return set(c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars())


def test_migration_check_with_only_workflow_secret(fresh_db):
    env, eng = fresh_db
    for name in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"):
        env.pop(name, None)
    result = run("migrate.py", env, "--env", "staging", "--check")
    assert result.returncode == 0, result.stdout
    assert tables(eng) == set()


def test_concurrent_migration_refuses_before_claim(fresh_db):
    env, eng = fresh_db
    with eng.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(1448040517, 1)"))
        result = run("migrate.py", env, "--env", "staging", "--claim-if-empty")
        assert result.returncode == 3 and "another migration" in result.stdout
        assert tables(eng) == set()


def test_build_never_changes_the_database(fresh_db):
    env, eng = fresh_db
    r = run("vercel_build.py", env | {"VERCEL_ENV": "preview"})
    assert r.returncode == 1 and "REFUSING TO DEPLOY" in r.stdout and "not been claimed" in r.stdout
    assert tables(eng) == set()  # read-only: no migrations, no role changes
    r = run("vercel_build.py", env)  # outside Vercel: no environment to check, but still not migrated
    assert r.returncode == 1 and "Run the migrations first" in r.stdout
    assert tables(eng) == set()


def test_explicit_migrations_claim_once_and_refuse_the_wrong_environment(fresh_db):
    env, eng = fresh_db
    # Not claimed: refuses without --claim, and with the wrong host typed back.
    r = run("migrate.py", env, "--env", "staging")
    assert r.returncode == 3 and "not claimed yet" in r.stdout and tables(eng) == set()
    r = run("migrate.py", env, "--env", "staging", "--claim", "--confirm-host", "db.example.com")
    assert r.returncode == 3 and tables(eng) == set()
    # Check mode never writes.
    r = run("migrate.py", env, "--env", "staging", "--check")
    assert r.returncode == 0 and "pending migrations: 0001" in r.stdout and tables(eng) == set()

    r = run("migrate.py", env, "--env", "staging", "--claim-if-empty")  # a brand-new database qualifies
    assert r.returncode == 0, r.stdout + r.stderr[-2000:]
    assert "claimed for staging" in r.stdout
    with eng.connect() as c:
        assert c.execute(text("SELECT environment FROM deployment_environment")).scalar() == "staging"
    # The runtime role logs in with its derived password, owns nothing and is subject to RLS.
    pw = platform.derive("owner-dev-only", "app-role")
    app = create_engine(f"postgresql+psycopg://voxera_app_buildtest:{pw}@localhost:5432/voxera_build_test")
    with app.connect() as c:
        assert c.execute(text("SELECT count(*) FROM organizations")).scalar() == 0
        privileged = "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = :r"
        assert c.execute(text(privileged), {"r": "voxera_app_buildtest"}).scalar() is False
        with pytest.raises(Exception, match="permission denied"):
            c.execute(text("UPDATE deployment_environment SET environment = 'production'"))
    app.dispose()

    # A production run against the staging database stops before changing anything.
    r = run("migrate.py", env, "--env", "production")
    assert r.returncode == 3 and "belongs to staging" in r.stdout
    # Re-running for the right environment is idempotent.
    assert run("migrate.py", env, "--env", "staging").returncode == 0

    # The preview build now passes; a production build refuses the staging database.
    assert run("vercel_build.py", env | {"VERCEL_ENV": "preview"}).returncode == 0
    r = run("vercel_build.py", env | {"VERCEL_ENV": "production"})
    assert r.returncode == 1 and "connected to the staging database" in r.stdout

    # Rollback is explicit, and the build then refuses the out-of-date schema.
    assert run("migrate.py", env, "--env", "staging", "--downgrade-to", "0006").returncode == 3  # needs --yes
    r = run("migrate.py", env, "--env", "staging", "--downgrade-to", "0006", "--yes")
    assert r.returncode == 0 and "rolled back to 0006" in r.stdout
    assert run("vercel_build.py", env | {"VERCEL_ENV": "preview"}).returncode == 1


def test_claim_if_empty_never_claims_an_existing_database(fresh_db):
    env, eng = fresh_db
    with eng.begin() as c:  # an unclaimed database that already holds data, like production today
        c.execute(text("CREATE TABLE customers (id int)"))
    r = run("migrate.py", env, "--env", "staging", "--claim-if-empty")
    assert r.returncode == 3 and "not claimed yet" in r.stdout
    assert tables(eng) == {"customers"}
    r = run("migrate.py", env, "--env", "production", "--claim", "--confirm-host", "localhost")
    assert r.returncode == 0 and "claimed for production" in r.stdout


def test_running_api_refuses_a_database_from_another_environment(monkeypatch, owner_engine):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("VOXERA_EXPECT_DB_ENV", "production")
    try:
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO deployment_environment (id, environment) VALUES (1, 'staging')"))
        with TestClient(create_app()) as client:
            assert client.get("/healthz").status_code == 200
            r = client.get("/readyz")
            assert r.status_code == 503 and "connected to the staging database" in r.json()["reason"]
            assert client.post("/v1/auth/login", json={"email": "a@b.co", "password": "x"}).status_code == 503
        with owner_engine.begin() as c:
            c.execute(text("UPDATE deployment_environment SET environment = 'production'"))
        with TestClient(create_app()) as client:
            assert client.get("/readyz").status_code == 200
    finally:
        with owner_engine.begin() as c:
            c.execute(text("DELETE FROM deployment_environment"))


def test_build_script_skips_without_database():
    prefixes = ("VOXERA_", "VERCEL", "DATABASE_URL", "POSTGRES_URL")
    env = {k: v for k, v in os.environ.items() if not k.startswith(prefixes)}
    r = build(env)
    assert r.returncode == 0 and "skipping the database preflight" in r.stdout

    for hosted in ({"VERCEL_ENV": "preview"}, {"VERCEL_ENV": "production"}):
        r = build(env | hosted)
        assert r.returncode == 1 and "missing database configuration" in r.stdout


@pytest.mark.parametrize(
    "variables",
    [
        {"VERCEL": "1"},
        {"VERCEL_ENV": "unknown"},
        {"VERCEL_ENV": "preview", "VOXERA_EXPECT_DB_ENV": "production"},
        {"VERCEL_ENV": "production", "VOXERA_EXPECT_DB_ENV": "staging"},
    ],
)
def test_invalid_hosted_identity_never_skips(monkeypatch, variables):
    from app.deploy_env import expected

    for key in ("VERCEL", "VERCEL_ENV", "VOXERA_EXPECT_DB_ENV"):
        monkeypatch.delenv(key, raising=False)
    for key, value in variables.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(ValueError):
        expected()


def _role_logs_in(role: str, password: str, database: str = "voxera_build_test") -> bool:
    eng = create_engine(f"postgresql+psycopg://{role}:{password}@localhost:5432/{database}")
    try:
        with eng.connect() as c:
            return c.execute(text("SELECT 1")).scalar() == 1
    except Exception:
        return False
    finally:
        eng.dispose()


def test_migration_never_locks_out_running_deployments(fresh_db, owner_engine):
    """The runtime role's password is only changed when it already matches, or on an explicit rotation."""
    env, eng = fresh_db
    derived = platform.derive("owner-dev-only", "app-role")
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(
            text("DO $$ BEGIN CREATE ROLE voxera_app_buildtest LOGIN; EXCEPTION WHEN duplicate_object THEN END $$")
        )
        c.execute(text("ALTER ROLE voxera_app_buildtest LOGIN PASSWORD 'what-running-deployments-use'"))
        c.execute(text("GRANT CONNECT ON DATABASE voxera_build_test TO voxera_app_buildtest"))

    # The check reports the mismatch and changes nothing.
    r = run("migrate.py", env, "--env", "staging", "--check")
    assert r.returncode == 0 and "uses a different password" in r.stdout
    assert "owner-dev-only" not in r.stdout + r.stderr and derived not in r.stdout + r.stderr  # no secrets printed
    # A claim or upgrade stops before touching anything: no schema, no claim, password unchanged.
    for args in (["--claim-if-empty"], ["--claim", "--confirm-host", "localhost"]):
        r = run("migrate.py", env, "--env", "staging", *args)
        assert r.returncode == 3 and "not changing the password" in r.stdout, r.stdout
        assert tables(eng) == set()
        assert _role_logs_in("voxera_app_buildtest", "what-running-deployments-use")
        assert not _role_logs_in("voxera_app_buildtest", derived)

    # A deliberate rotation may change it.
    r = run("migrate.py", env, "--env", "staging", "--claim-if-empty", "--reset-runtime-role")
    assert r.returncode == 0 and "claimed for staging" in r.stdout, r.stdout
    assert _role_logs_in("voxera_app_buildtest", derived)
    assert not _role_logs_in("voxera_app_buildtest", "what-running-deployments-use")

    # Once it matches, check and upgrade say so and proceed without the flag.
    r = run("migrate.py", env, "--env", "staging", "--check")
    assert r.returncode == 0 and "already logs in with the password this run would set" in r.stdout
    r = run("migrate.py", env, "--env", "staging")
    assert r.returncode == 0 and "runtime role voxera_app_buildtest ready" in r.stdout
    assert _role_logs_in("voxera_app_buildtest", derived)


def test_migration_creates_a_missing_runtime_role(fresh_db, owner_engine):
    env, eng = fresh_db
    role = f"voxera_app_probe_{os.getpid()}"
    env = env | {"VOXERA_APP_ROLE": role}
    try:
        r = run("migrate.py", env, "--env", "staging", "--check")
        assert r.returncode == 0 and "does not exist yet" in r.stdout and tables(eng) == set()
        r = run("migrate.py", env, "--env", "staging", "--claim-if-empty")
        assert r.returncode == 0 and "claimed for staging" in r.stdout, r.stdout
        assert _role_logs_in(role, platform.derive("owner-dev-only", "app-role"))
    finally:
        eng.dispose()
        with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
            c.execute(text("DROP DATABASE IF EXISTS voxera_build_test WITH (FORCE)"))
            c.execute(text(f"DROP ROLE IF EXISTS {role}"))
