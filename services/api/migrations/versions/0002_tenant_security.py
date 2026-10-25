"""Tenant isolation and least privilege.

- Row-level security on every tenant table, keyed on the transaction-local setting
  ``app.org_id`` (set by app/db.py for each transaction).
- The runtime API role does not own any table, so the policies always apply to it.
- The audit log is append-only: the API role cannot UPDATE or DELETE it, and an
  UPDATE trigger rejects edits even from the owner. Rows are removed only by the
  ON DELETE CASCADE when a whole organisation is deleted.
- Usage events are insert-only for the API role so metered totals cannot be edited.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

from alembic import context, op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENANT_TABLES = [
    "business_profiles",
    "office_hours",
    "services",
    "workspace_settings",
    "agents",
    "audit_logs",
    "usage_events",
]
ALL_TABLES = [
    "users",
    "auth_sessions",
    "refresh_tokens",
    "organizations",
    "memberships",
    "invitations",
    *TENANT_TABLES,
    "deletion_receipts",
]


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    role = _role()
    op.execute("""
        CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
        CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
    """)

    # organisations: visible to members (for "my workspaces") or when it is the active tenant.
    op.execute("""
        ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
        CREATE POLICY org_select ON organizations FOR SELECT USING (
            id = app_org() OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = organizations.id AND m.user_id = app_user()));
        CREATE POLICY org_insert ON organizations FOR INSERT WITH CHECK (id = app_org());
        CREATE POLICY org_update ON organizations FOR UPDATE USING (id = app_org()) WITH CHECK (id = app_org());
        CREATE POLICY org_delete ON organizations FOR DELETE USING (id = app_org());
    """)
    # memberships: a user can see their own memberships across workspaces; everything else is per-tenant.
    op.execute("""
        ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
        CREATE POLICY mem_select ON memberships FOR SELECT USING (organization_id = app_org() OR user_id = app_user());
        CREATE POLICY mem_write ON memberships FOR INSERT WITH CHECK (organization_id = app_org());
        CREATE POLICY mem_update ON memberships FOR UPDATE USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        CREATE POLICY mem_delete ON memberships FOR DELETE USING (organization_id = app_org());
    """)
    # invitations: also readable by whoever holds the token (app.invite_hash), so it can be accepted.
    op.execute("""
        ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
        CREATE POLICY inv_select ON invitations FOR SELECT USING (
            organization_id = app_org() OR token_hash = nullif(current_setting('app.invite_hash', true), ''));
        CREATE POLICY inv_insert ON invitations FOR INSERT WITH CHECK (organization_id = app_org());
        CREATE POLICY inv_update ON invitations FOR UPDATE USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        CREATE POLICY inv_delete ON invitations FOR DELETE USING (organization_id = app_org());
    """)
    for t in TENANT_TABLES:
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {t} USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)

    op.execute("""
        CREATE FUNCTION reject_audit_update() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
        CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_update();
    """)

    op.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
    op.execute(f"GRANT EXECUTE ON FUNCTION app_org(), app_user() TO {role}")
    for t in ALL_TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO {role}")
    op.execute(f"REVOKE UPDATE, DELETE ON audit_logs, usage_events FROM {role}")
    op.execute(f"REVOKE SELECT, UPDATE, DELETE ON deletion_receipts FROM {role}")


def downgrade() -> None:
    role = _role()
    for t in ALL_TABLES:
        op.execute(f"REVOKE ALL ON {t} FROM {role}")
    op.execute(
        "DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs; DROP FUNCTION IF EXISTS reject_audit_update()"
    )
    for t in ["organizations", "memberships", "invitations", *TENANT_TABLES]:
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
        op.execute(
            f"DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE tablename = '{t}' "
            f"LOOP EXECUTE format('DROP POLICY %I ON {t}', p.policyname); END LOOP; END $$"
        )
    op.execute("DROP FUNCTION IF EXISTS app_org(); DROP FUNCTION IF EXISTS app_user()")
