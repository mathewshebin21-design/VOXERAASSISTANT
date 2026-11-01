"""Hosted (Vercel + Neon) configuration and the build-time database bootstrap."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

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


def test_build_script_creates_runtime_role_and_migrates(owner_engine):
    """Runs scripts/vercel_build.py against a fresh database, as Vercel would."""
    base = "postgresql://voxera_owner:owner-dev-only@localhost:5432"
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("DROP DATABASE IF EXISTS voxera_build_test"))
        c.execute(text("CREATE DATABASE voxera_build_test OWNER voxera_owner"))
    env = {k: v for k, v in os.environ.items() if not k.startswith("VOXERA_")}
    env |= {"DATABASE_URL": f"{base}/voxera_build_test", "DATABASE_URL_UNPOOLED": f"{base}/voxera_build_test"}
    env["VOXERA_APP_ROLE"] = "voxera_app_buildtest"  # roles are cluster-wide: don't touch the suite's voxera_app
    r = build(env)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "migrations complete" in r.stdout
    # The runtime role can log in with the derived password and is subject to RLS.
    pw = platform.derive("owner-dev-only", "app-role")
    app = create_engine(f"postgresql+psycopg://voxera_app_buildtest:{pw}@localhost:5432/voxera_build_test")
    with app.connect() as c:
        assert c.execute(text("SELECT count(*) FROM organizations")).scalar() == 0
        assert (
            c.execute(
                text(
                    "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = 'voxera_app_buildtest'"
                )
            ).scalar()
            is False
        )
    app.dispose()
    # Re-running (every deploy) is idempotent.
    r2 = build(env)
    assert r2.returncode == 0, r2.stderr[-2000:]


def test_build_script_skips_without_database():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VOXERA_", "DATABASE_URL", "POSTGRES_URL"))}
    r = build(env)
    assert r.returncode == 0 and "skipping migrations" in r.stdout
