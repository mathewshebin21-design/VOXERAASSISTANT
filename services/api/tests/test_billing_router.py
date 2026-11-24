"""Authenticated billing overview route acceptance on disposable PostgreSQL."""


def test_billing_overview_requires_auth(client):
    response = client.get("/v1/orgs/00000000-0000-0000-0000-000000000001/billing/overview?month=2026-11")
    assert response.status_code in (401, 403)


def test_billing_overview_tenant_read(make_account):
    account = make_account("billing-route-owner@example.com")
    response = account.get(account.o("/billing/overview?month=2026-11"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["organization_id"] == account.org_id
    assert body["state"] is None
    assert body["quota_available"] is None
    assert body["synthetic_usage_events"] == 0


def test_billing_overview_rejects_invalid_month(make_account):
    account = make_account("billing-route-month@example.com")
    response = account.get(account.o("/billing/overview?month=2026-13"))
    assert response.status_code == 422


def test_billing_overview_rejects_other_organization(make_account):
    owner = make_account("billing-route-tenant-owner@example.com")
    stranger = make_account("billing-route-tenant-stranger@example.com")
    response = stranger.get(owner.o("/billing/overview?month=2026-11"))
    assert response.status_code in (403, 404)


def test_billing_overview_rejects_unicode_digits(make_account):
    account = make_account("billing-route-unicode-month@example.com")
    response = account.get(account.o("/billing/overview?month=２０２６-11"))
    assert response.status_code == 422


def test_billing_overview_rejects_year_zero(make_account):
    account = make_account("billing-route-year-zero@example.com")
    response = account.get(account.o("/billing/overview?month=0000-01"))
    assert response.status_code == 422


def test_billing_overview_rejects_unrepresentable_final_month(make_account):
    account = make_account("billing-route-year-max@example.com")
    response = account.get(account.o("/billing/overview?month=9999-12"))
    assert response.status_code == 422
