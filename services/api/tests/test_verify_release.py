"""The read-only release verifier, run against the test database at head."""

import os
import sys
from pathlib import Path

from sqlalchemy import text

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
