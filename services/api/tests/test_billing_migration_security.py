"""Security regression checks for billing migrations on disposable PostgreSQL.

These checks intentionally use the application role and real RLS, not a
superuser connection. They do not mutate production or shared staging.
"""

from sqlalchemy import text


def test_billing_inbox_reconciliation_grant(app_engine):
    with app_engine.connect() as conn:
        assert conn.execute(
            text("SELECT has_column_privilege(current_user, 'billing_provider_inbox', 'status', 'UPDATE')")
        ).scalar_one() is True


def test_billing_inbox_payload_digest_is_not_mutable(app_engine):
    with app_engine.connect() as conn:
        assert conn.execute(
            text("SELECT has_column_privilege(current_user, 'billing_provider_inbox', 'payload_sha256', 'UPDATE')")
        ).scalar_one() is False


def test_billing_quota_tables_have_rls_and_no_bypass(app_engine):
    with app_engine.connect() as conn:
        role = conn.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).one()
        assert role == (False, False)
        for table in ("billing_quota_periods", "billing_quota_reservations"):
            assert conn.execute(
                text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(:table)"),
                {"table": table},
            ).scalar_one() is True


def test_billing_quota_tables_not_accessible_without_tenant(app_engine):
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', '', true)"))
        assert conn.execute(text("SELECT count(*) FROM billing_quota_periods")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM billing_quota_reservations")).scalar_one() == 0
