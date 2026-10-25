from sqlalchemy import text

from .conftest import join


def test_owner_can_export_workspace_without_secrets(make_account):
    a = make_account("ada@example.com", "Halden & Rye")
    a.post(a.o("/services"), json={"name": "Cut", "duration_min": 30})
    a.post(a.o("/invitations"), json={"email": "x@y.example"})
    r = a.get(a.o("/export"))
    assert r.status_code == 200
    data = r.json()
    assert data["organization"]["name"] == "Halden & Rye"
    assert data["services"][0]["name"] == "Cut" and data["members"][0]["role"] == "owner"
    blob = r.text
    assert "token_hash" not in blob and "password_hash" not in blob and "$argon2" not in blob
    assert any(l["action"] == "organization.exported" for l in a.get(a.o("/audit-logs")).json())


def test_personal_export_contains_no_credentials(make_account):
    a = make_account("ada@example.com")
    r = a.get("/v1/me/export")
    assert r.status_code == 200 and r.json()["user"]["email"] == "ada@example.com"
    assert "argon2" not in r.text and "refresh" not in r.text


def test_deleting_workspace_removes_all_tenant_data(make_account, owner_engine):
    a = make_account("ada@example.com", "Halden & Rye")
    keep = make_account("bo@example.com", "Other")
    a.post(a.o("/services"), json={"name": "Cut", "duration_min": 30})
    a.post(a.o("/agents"), json={"name": "Rye", "greeting": "Hi, I'm the AI receptionist."})
    assert a.delete(a.o(), json={"confirm_name": "wrong"}).status_code == 400
    assert a.delete(a.o(), json={"confirm_name": "Halden & Rye"}).status_code == 204
    with owner_engine.connect() as c:
        for t in ["services", "agents", "audit_logs", "business_profiles", "workspace_settings", "memberships"]:
            n = c.execute(text(f"SELECT count(*) FROM {t} WHERE organization_id = :o"), {"o": a.org_id}).scalar()
            assert n == 0, t
        assert (
            c.execute(text("SELECT count(*) FROM deletion_receipts WHERE subject_id = :o"), {"o": a.org_id}).scalar()
            == 1
        )
        assert (
            c.execute(text("SELECT count(*) FROM services WHERE organization_id = :o"), {"o": keep.org_id}).scalar()
            == 0
        )
    assert keep.get(keep.o()).status_code == 200


def test_account_deletion_removes_solo_workspace(make_account, owner_engine, client):
    a = make_account("ada@example.com")
    assert a.delete("/v1/me", json={"password": "wrong password"}).status_code == 403
    assert a.delete("/v1/me", json={"password": a.password}).status_code == 204
    assert client.post("/v1/auth/login", json={"email": a.email, "password": a.password}).status_code == 401
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM organizations WHERE id = :o"), {"o": a.org_id}).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 0


def test_last_owner_of_shared_workspace_must_transfer_before_deleting(make_account):
    owner = make_account("owner@studio.example", "Studio")
    member = make_account("member@studio.example", "Home")
    join(owner, member, "manager")
    assert owner.delete("/v1/me", json={"password": owner.password}).status_code == 409
    member.org_id = owner.org_id
    owner.patch(owner.o(f"/members/{member.user_id}"), json={"role": "owner"})
    assert owner.delete("/v1/me", json={"password": owner.password}).status_code == 204
    assert member.get(member.o("/members")).json()[0]["email"] == "member@studio.example"
