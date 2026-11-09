"""Interface design preference: owner-controlled workspace default, per-member override."""

import os

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from .conftest import join


def design(a, org=None):
    r = a.get(f"/v1/orgs/{org or a.org_id}/design")
    assert r.status_code == 200, r.text
    return r.json()


def test_new_workspace_defaults_to_atelier(make_account):
    a = make_account("owner@example.com")
    assert design(a) == {
        "workspace_default": "atelier",
        "my_override": None,
        "effective": "atelier",
        "can_set_default": True,
    }


def test_owner_sets_default_and_it_persists(client, make_account):
    a = make_account("owner@example.com")
    r = a.put(a.o("/design/default"), json={"design": "command"})
    assert r.status_code == 200 and r.json()["workspace_default"] == "command"
    # A fresh read (new request, new session) returns the stored value.
    assert design(a)["effective"] == "command"
    assert any(e["action"] == "design.default_changed" for e in a.get(a.o("/audit-logs")).json())


@pytest.mark.parametrize("role", ["admin", "manager", "staff", "viewer"])
def test_only_the_owner_changes_the_default(make_account, role):
    owner = make_account("owner@example.com")
    member = make_account(f"{role}@example.com", "Elsewhere")
    join(owner, member, role)
    r = member.put(owner.o("/design/default"), json={"design": "flow"})
    assert r.status_code == 403
    assert design(owner)["workspace_default"] == "atelier"
    assert design(member, owner.org_id)["can_set_default"] is False


def test_member_override_affects_only_that_member(make_account):
    owner = make_account("owner@example.com")
    staff = make_account("staff@example.com", "Elsewhere")
    viewer = make_account("viewer@example.com", "Elsewhere 2")
    join(owner, staff, "staff")
    join(owner, viewer, "viewer")
    r = staff.put(owner.o("/design/me"), json={"design": "flow"})
    assert r.status_code == 200
    assert r.json() == {
        "workspace_default": "atelier",
        "my_override": "flow",
        "effective": "flow",
        "can_set_default": False,
    }
    # Nobody else's view changed.
    assert design(owner)["effective"] == "atelier"
    assert design(viewer, owner.org_id)["effective"] == "atelier"
    # A later change of default reaches members without an override, not the one who chose.
    owner.put(owner.o("/design/default"), json={"design": "command"})
    assert design(viewer, owner.org_id)["effective"] == "command"
    assert design(staff, owner.org_id)["effective"] == "flow"


def test_override_can_be_cleared_back_to_the_default(make_account):
    a = make_account("owner@example.com")
    a.put(a.o("/design/me"), json={"design": "flow"})
    assert design(a)["effective"] == "flow"
    r = a.put(a.o("/design/me"), json={"design": None})
    assert r.status_code == 200 and r.json()["my_override"] is None and r.json()["effective"] == "atelier"


def test_override_is_per_workspace(make_account):
    """A member of two workspaces can pick a different design in each."""
    a = make_account("a@example.com", "Studio A")
    b = make_account("b@example.com", "Studio B")
    join(b, a, "staff")
    a.put(a.o("/design/me"), json={"design": "command"})
    assert design(a)["effective"] == "command"
    assert design(a, b.org_id)["effective"] == "atelier"


@pytest.mark.parametrize("bad", ["", "Command", "dashboard", 3, None])
def test_unknown_designs_are_rejected(make_account, bad):
    a = make_account("owner@example.com")
    assert a.put(a.o("/design/default"), json={"design": bad}).status_code == 422
    assert a.put(a.o("/design/me"), json={"design": "nope"}).status_code == 422
    assert a.put(a.o("/design/me"), json={"design": "flow", "extra": 1}).status_code == 422
    assert design(a)["effective"] == "atelier"


def test_other_tenants_cannot_read_or_change_the_design(make_account):
    a = make_account("a@example.com", "Studio A")
    b = make_account("b@example.com", "Studio B")
    assert b.get(a.o("/design")).status_code == 404
    assert b.put(a.o("/design/default"), json={"design": "flow"}).status_code == 404
    assert b.put(a.o("/design/me"), json={"design": "flow"}).status_code == 404
    assert design(a)["effective"] == "atelier"


def test_signed_out_requests_are_refused(client, make_account):
    a = make_account("a@example.com")
    assert client.get(a.o("/design")).status_code == 401
    assert client.put(a.o("/design/default"), json={"design": "flow"}).status_code == 401


def test_database_rejects_invalid_values(owner_engine, make_account):
    """The check constraints hold even if the API is bypassed."""
    a = make_account("a@example.com")
    with owner_engine.connect() as c:
        for sql in (
            "UPDATE workspace_settings SET ui_design = 'retro' WHERE organization_id = :o",
            "UPDATE memberships SET ui_design = 'retro' WHERE organization_id = :o",
        ):
            with pytest.raises(Exception, match="ck_.*ui_design"), c.begin():
                c.execute(text(sql), {"o": a.org_id})


def test_migration_0009_round_trip_keeps_existing_data(owner_engine, make_account):
    """Downgrade to 0007 and upgrade again with live rows: data survives, defaults apply."""
    a = make_account("a@example.com")
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.environ["VOXERA_MIGRATION_DATABASE_URL"])
    try:
        command.downgrade(cfg, "0007")
        with owner_engine.connect() as c:
            cols = c.execute(
                text("SELECT column_name FROM information_schema.columns WHERE column_name = 'ui_design'")
            ).all()
            assert cols == []
    finally:
        command.upgrade(cfg, "head")
    with owner_engine.connect() as c:
        head = ScriptDirectory.from_config(cfg).get_current_head()
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
        assert c.execute(text("SELECT count(*) FROM organizations")).scalar() == 1
        assert c.execute(text("SELECT ui_design FROM workspace_settings")).scalar() == "atelier"
        assert c.execute(text("SELECT ui_design FROM memberships")).scalar() is None
    assert design(a)["effective"] == "atelier"
