"""Security regression checks for billing migrations on disposable PostgreSQL.

These checks intentionally use the application role and real RLS, not a
superuser connection. They do not mutate production or shared staging.
"""

from sqlalchemy import text


def test_billing_inbox_reconciliation_grant(app_engine):
    with app_engine.connect() as conn:
        assert (
            conn.execute(
                text("SELECT has_column_privilege(current_user, 'billing_provider_inbox', 'status', 'UPDATE')")
            ).scalar_one()
            is True
        )


def test_billing_inbox_payload_digest_is_not_mutable(app_engine):
    with app_engine.connect() as conn:
        assert (
            conn.execute(
                text("SELECT has_column_privilege(current_user, 'billing_provider_inbox', 'payload_sha256', 'UPDATE')")
            ).scalar_one()
            is False
        )


def test_billing_quota_tables_have_rls_and_no_bypass(app_engine):
    with app_engine.connect() as conn:
        role = conn.execute(text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).one()
        assert role == (False, False)
        for table in ("billing_quota_periods", "billing_quota_reservations"):
            assert (
                conn.execute(
                    text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(:table)"),
                    {"table": table},
                ).scalar_one()
                is True
            )


def test_billing_quota_tables_not_accessible_without_tenant(app_engine):
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', '', true)"))
        assert conn.execute(text("SELECT count(*) FROM billing_quota_periods")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM billing_quota_reservations")).scalar_one() == 0



def test_billing_quota_constraints_exist_in_database(app_engine):
    """Check that quota safety is enforced by PostgreSQL, not only Python."""
    expected = {
        "billing_quota_periods": {"ck_billing_quota_within_limit"},
        "billing_quota_reservations": {
            "ck_billing_reservation_units",
            "ck_billing_reservation_consumed",
            "uq_billing_quota_reservation_identity",
        },
    }
    with app_engine.connect() as conn:
        for table, names in expected.items():
            actual = set(
                conn.execute(
                    text(
                        "SELECT conname FROM pg_constraint "
                        "WHERE conrelid = to_regclass(:table)"
                    ),
                    {"table": table},
                ).scalars()
            )
            assert names <= actual, f"{table} missing constraints: {names - actual}"


def test_billing_quota_rls_policy_is_tenant_scoped(app_engine):
    """Verify both read and write tenant predicates exist on quota tables."""
    with app_engine.connect() as conn:
        for table in ("billing_quota_periods", "billing_quota_reservations"):
            policies = conn.execute(
                text(
                    "SELECT qual, with_check FROM pg_policies "
                    "WHERE schemaname = current_schema() AND tablename = :table "
                    "AND policyname = 'tenant_isolation'"
                ),
                {"table": table},
            ).all()
            assert len(policies) == 1
            read_predicate, write_predicate = policies[0]
            assert "app_org()" in read_predicate
            assert "app_org()" in write_predicate
