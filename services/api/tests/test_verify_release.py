"""The read-only release verifier, run against the test database at head."""

import os
import sys
from pathlib import Path

import pytest
from psycopg import errors
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import verify_release  # noqa: E402


def test_owner_checks_pass_at_head_and_never_write(owner_engine, make_account):
    make_account("a@example.com")
    with owner_engine.connect() as c:
        head = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
        c.execute(text("SET TRANSACTION READ ONLY"))
        results, counts, tenant = verify_release.owner_checks(c, "production", head)
    failed = {name for name, ok, _ in results if not ok}
    # The test database is not claimed for an environment; everything else must hold.
    assert failed <= {"database claimed for the expected environment"}
    names = {name for name, _, _ in results}
    assert {
        "0008 table agent_flows exists",
        "check constraint ck_settings_ui_design",
        "0010 table rate_limit_hits exists",
        "rate_limit_hits: runtime role has no SELECT",
        "0011 table calls exists",
        "call events: runtime role has no DELETE",
        "staff_notification_outbox: unique case and channel",
        "staff_notification_attempts: foreign key binds parent and tenant",
        "staff_notification_attempts: runtime UPDATE denied",
    } <= names
    assert "workspace_settings" in tenant and counts["organizations"] == 1


def test_runtime_role_sees_no_rows_without_a_tenant(owner_engine, make_account):
    make_account("a@example.com")
    with owner_engine.connect() as c:
        _, _, tenant = verify_release.owner_checks(c, "production", "0009")
    results = verify_release.runtime_checks(os.environ["VOXERA_DATABASE_URL"], tenant)
    assert all(ok for _, ok, _ in results), [r for r in results if not r[1]]


def test_wrong_revision_fails(owner_engine):
    with owner_engine.connect() as c:
        results, _, _ = verify_release.owner_checks(c, "production", "0001")
    assert ("schema revision", False) in {(n, ok) for n, ok, _ in results}


def test_missing_table_is_not_reported_as_successful_isolation():
    results = verify_release.runtime_checks(os.environ["VOXERA_DATABASE_URL"], ["missing_release_probe_table"])
    assert any(not ok for _, ok, _ in results)
    assert ("runtime query failed for missing_release_probe_table", False) in {(n, ok) for n, ok, _ in results}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (DBAPIError(None, None, errors.InsufficientPrivilege("private detail")), True),
        (DBAPIError(None, None, errors.QueryCanceled("private detail")), False),
        (DBAPIError(None, None, errors.UndefinedTable("private detail")), False),
        (DBAPIError(None, None, errors.ConnectionFailure("private detail")), False),
        (RuntimeError("private detail"), False),
    ],
)
def test_only_explicit_permission_denial_proves_access_is_blocked(monkeypatch, error, expected):
    class Connection:
        rolled_back = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, statement):
            if str(statement) == "SELECT current_user":
                return self
            raise error

        def scalar(self):
            return verify_release.APP_ROLE

        def rollback(self):
            self.rolled_back = True

    connection = Connection()

    class Engine:
        def connect(self):
            return connection

    monkeypatch.setattr(verify_release, "_engine", lambda url: Engine())
    results = verify_release.runtime_checks("unused", ["workspace_settings"])
    assert results[-1][1] is expected
    assert connection.rolled_back
    assert "private detail" not in str(results)


def test_notification_attempt_history_rejects_privilege_drift(owner_engine):
    with owner_engine.connect() as c:
        c.execute(text("GRANT UPDATE ON staff_notification_attempts TO voxera_app"))
        results, _, _ = verify_release.owner_checks(c, "production", "0013")
        c.rollback()
    assert ("staff_notification_attempts: runtime UPDATE denied", False, "") in results
