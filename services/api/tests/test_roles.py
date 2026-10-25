import pytest

from .conftest import join


@pytest.fixture
def team(make_account):
    owner = make_account("owner@studio.example", "Studio")
    admin, manager, viewer = (make_account(f"{r}@studio.example", f"{r} home") for r in ("admin", "manager", "viewer"))
    for m, role in ((admin, "admin"), (manager, "manager"), (viewer, "viewer")):
        join(owner, m, role)
        m.org_id = owner.org_id  # act inside the shared workspace
    return owner, admin, manager, viewer


SERVICE = {"name": "Blow-dry", "duration_min": 45}


def test_viewer_can_read_but_not_write(team):
    _, _, _, viewer = team
    assert viewer.get(viewer.o("/services")).status_code == 200
    assert viewer.post(viewer.o("/services"), json=SERVICE).status_code == 403
    assert viewer.put(viewer.o("/office-hours"), json={"intervals": []}).status_code == 403
    assert (
        viewer.post(viewer.o("/agents"), json={"name": "X", "greeting": "Hello, I'm the AI receptionist."}).status_code
        == 403
    )
    assert viewer.get(viewer.o("/audit-logs")).status_code == 403


def test_manager_cannot_change_business_settings_or_members(team):
    owner, _, manager, viewer = team
    assert manager.patch(manager.o("/settings"), json={"recording_retention_days": 30}).status_code == 403
    assert manager.patch(manager.o(f"/members/{viewer.user_id}"), json={"role": "admin"}).status_code == 403


def test_admin_manages_business_but_not_export_delete_or_owner_role(team):
    owner, admin, _, viewer = team
    assert admin.post(admin.o("/services"), json=SERVICE).status_code == 201
    assert admin.patch(admin.o(f"/members/{viewer.user_id}"), json={"role": "manager"}).status_code == 200
    assert admin.get(admin.o("/export")).status_code == 403
    assert admin.delete(admin.o(), json={"confirm_name": "Studio"}).status_code == 403
    assert admin.patch(admin.o(f"/members/{viewer.user_id}"), json={"role": "owner"}).status_code == 403
    assert admin.patch(admin.o(f"/members/{owner.user_id}"), json={"role": "viewer"}).status_code == 403
    assert admin.post(admin.o("/invitations"), json={"email": "x@studio.example", "role": "owner"}).status_code == 403


def test_last_owner_cannot_be_demoted_or_removed(team):
    owner, *_ = team
    assert owner.patch(owner.o(f"/members/{owner.user_id}"), json={"role": "admin"}).status_code == 409
    assert owner.delete(owner.o(f"/members/{owner.user_id}")).status_code == 409


def test_owner_can_transfer_ownership_then_step_down(team):
    owner, admin, *_ = team
    assert owner.patch(owner.o(f"/members/{admin.user_id}"), json={"role": "owner"}).status_code == 200
    assert owner.patch(owner.o(f"/members/{owner.user_id}"), json={"role": "admin"}).status_code == 200


def test_members_can_leave_and_lose_access(team):
    _, _, _, viewer = team
    assert viewer.delete(viewer.o(f"/members/{viewer.user_id}")).status_code == 204
    assert viewer.get(viewer.o("/services")).status_code == 404


def test_viewer_cannot_remove_others(team):
    _, admin, _, viewer = team
    assert viewer.delete(viewer.o(f"/members/{admin.user_id}")).status_code == 403


def test_invitation_rules(make_account):
    owner = make_account("owner@studio.example", "Studio")
    guest = make_account("guest@else.example", "Elsewhere")
    stranger = make_account("stranger@else.example", "Other")
    token = owner.post(owner.o("/invitations"), json={"email": guest.email, "role": "manager"}).json()["token"]
    assert stranger.post("/v1/invitations/accept", json={"token": token}).status_code == 403  # wrong email
    r = guest.post("/v1/invitations/accept", json={"token": token})
    assert r.status_code == 200 and r.json()["role"] == "manager"
    assert guest.post("/v1/invitations/accept", json={"token": token}).status_code == 400  # single use
    assert owner.post(owner.o("/invitations"), json={"email": guest.email}).status_code == 409  # already a member


def test_revoked_invitation_cannot_be_used(make_account):
    owner = make_account("owner@studio.example", "Studio")
    guest = make_account("guest@else.example", "Elsewhere")
    inv = owner.post(owner.o("/invitations"), json={"email": guest.email}).json()
    assert owner.delete(owner.o(f"/invitations/{inv['id']}")).status_code == 204
    assert guest.post("/v1/invitations/accept", json={"token": inv["token"]}).status_code == 400


def test_invitation_tokens_are_not_listed(make_account):
    owner = make_account("owner@studio.example", "Studio")
    owner.post(owner.o("/invitations"), json={"email": "x@y.example"})
    assert all(i["token"] is None for i in owner.get(owner.o("/invitations")).json())
