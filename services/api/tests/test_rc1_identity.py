"""The RC-1 identity probe: answers only on the RC-1 profile and reports no secrets."""

from unittest.mock import patch

import pytest
from sqlalchemy import text

from app import rc1_preview


def test_absent_outside_rc1(client):
    assert client.get("/rc1-identity").status_code == 404


def test_absent_when_rc1_profile_is_misconfigured(client):
    with patch.object(rc1_preview, "active", side_effect=rc1_preview.ConfigError("RC-1 requires its exact")):
        assert client.get("/rc1-identity").status_code == 404


@pytest.fixture
def schema_grant(owner_engine):
    """Mirror the read-only grant applied to the dedicated RC-1 database (test database only)."""
    with owner_engine.begin() as c:
        c.execute(text("GRANT SELECT ON alembic_version TO voxera_app"))
    yield
    with owner_engine.begin() as c:
        c.execute(text("REVOKE SELECT ON alembic_version FROM voxera_app"))


def rc1_get(client):
    with (
        patch.object(rc1_preview, "active", return_value=True),
        patch.dict("os.environ", {"VERCEL_GIT_COMMIT_SHA": "a" * 40}),
    ):
        return client.get("/rc1-identity")


def test_unreadable_schema_is_reported_not_raised(client):
    r = rc1_get(client)
    assert r.status_code == 200
    assert r.json()["schema"] is None


def test_reports_runtime_identity_from_the_live_connection(client, owner_engine, schema_grant):
    with (
        patch.object(rc1_preview, "active", return_value=True),
        patch.dict("os.environ", {"VERCEL_GIT_COMMIT_SHA": "a" * 40}),
    ):
        r = client.get("/rc1-identity")
    assert r.status_code == 200
    body = r.json()
    # The test database is unclaimed and is not the dedicated "neondb" database.
    assert body == {
        "profile": "rc1-validation",
        "commit": "a" * 40,
        "environment": None,
        "schema": body["schema"],
        "runtime_role": True,
        "superuser": False,
        "bypass_rls": False,
        "dedicated_database": False,
    }
    with owner_engine.connect() as c:
        assert body["schema"] == c.execute(text("SELECT version_num FROM alembic_version")).scalar()
    text_body = r.text
    for secret in ("voxera_app", "localhost", "dev-only", "postgres"):
        assert secret not in text_body
