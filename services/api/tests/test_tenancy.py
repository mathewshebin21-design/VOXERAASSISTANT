"""Cross-tenant isolation: enforced by the API and, independently, by Postgres RLS."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


@pytest.fixture
def two(make_account):
    a = make_account("ada@alpha.example", "Alpha")
    b = make_account("bo@beta.example", "Beta")
    svc = b.post(b.o("/services"), json={"name": "Balayage", "duration_min": 180}).json()
    agent = b.post(b.o("/agents"), json={"name": "Rye", "greeting": "Hi, I'm Rye, the AI receptionist."}).json()
    return a, b, svc, agent


READ_PATHS = [
    "",
    "/members",
    "/business-profile",
    "/office-hours",
    "/services",
    "/settings",
    "/agents",
    "/audit-logs",
    "/invitations",
    "/usage/summary?month=2026-10",
    "/export",
]


@pytest.mark.parametrize("path", READ_PATHS)
def test_user_cannot_read_another_workspace(two, path):
    a, b, _, _ = two
    r = a.get(f"/v1/orgs/{b.org_id}{path}")
    assert r.status_code == 404, f"{path} leaked: {r.status_code}"


def test_user_cannot_touch_another_workspaces_records_even_with_ids(two):
    a, b, svc, agent = two
    assert a.patch(f"/v1/orgs/{b.org_id}/services/{svc['id']}", json={"name": "Hacked"}).status_code == 404
    # Using their own org id with someone else's record id must not find it either.
    assert a.patch(a.o(f"/services/{svc['id']}"), json={"name": "Hacked"}).status_code == 404
    assert a.delete(a.o(f"/agents/{agent['id']}")).status_code == 404
    assert b.get(b.o(f"/services/{svc['id']}")).json()["name"] == "Balayage"


def test_unknown_org_and_nonmember_look_identical(two):
    a, b, _, _ = two
    assert a.get(f"/v1/orgs/{uuid.uuid4()}").status_code == a.get(f"/v1/orgs/{b.org_id}").status_code == 404


def test_my_organizations_lists_only_my_workspaces(two):
    a, _, _, _ = two
    names = [o["organization"]["name"] for o in a.get("/v1/me/organizations").json()]
    assert names == ["Alpha"]


def _as_app(app_engine, org_id: str | None):
    conn = app_engine.connect()
    trans = conn.begin()
    if org_id:
        conn.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org_id})
    return conn, trans


def test_rls_filters_rows_without_application_filters(two, app_engine):
    a, b, _, _ = two
    conn, trans = _as_app(app_engine, a.org_id)
    try:
        orgs = {
            str(r[0])
            for r in conn.execute(text("SELECT organization_id FROM services UNION SELECT organization_id FROM agents"))
        }
        assert str(b.org_id) not in orgs
        assert (
            conn.execute(text("SELECT count(*) FROM audit_logs WHERE organization_id = :b"), {"b": b.org_id}).scalar()
            == 0
        )
    finally:
        trans.rollback()
        conn.close()


def test_rls_returns_nothing_without_tenant_context(two, app_engine):
    conn, trans = _as_app(app_engine, None)
    try:
        for t in [
            "services",
            "agents",
            "audit_logs",
            "business_profiles",
            "workspace_settings",
            "invitations",
            "memberships",
            "organizations",
        ]:
            assert conn.execute(text(f"SELECT count(*) FROM {t}")).scalar() == 0, t
    finally:
        trans.rollback()
        conn.close()


def test_rls_blocks_writing_into_another_tenant(two, app_engine):
    a, b, _, _ = two
    conn, trans = _as_app(app_engine, a.org_id)
    try:
        with pytest.raises(DBAPIError, match="row-level security"):
            conn.execute(
                text(
                    "INSERT INTO services (id, organization_id, name, duration_min, buffer_min, bookable_by_agent, requires_patch_test, active) "
                    "VALUES (gen_random_uuid(), :b, 'Injected', 30, 0, true, false, true)"
                ),
                {"b": b.org_id},
            )
    finally:
        trans.rollback()
        conn.close()


def test_rls_update_of_other_tenant_affects_no_rows(two, app_engine):
    a, b, svc, _ = two
    conn, trans = _as_app(app_engine, a.org_id)
    try:
        res = conn.execute(text("UPDATE services SET name = 'Hacked' WHERE id = :id"), {"id": svc["id"]})
        assert res.rowcount == 0
    finally:
        trans.rollback()
        conn.close()


def test_api_role_does_not_own_tables(app_engine):
    with app_engine.connect() as c:
        owners = {r[0] for r in c.execute(text("SELECT tableowner FROM pg_tables WHERE schemaname = 'public'"))}
        me = c.execute(text("SELECT current_user")).scalar()
    assert me not in owners
