"""Global monthly totals of live (billable) usage, for spending caps across all workspaces.

usage_events is protected by RLS, so the API role can only see its own tenant's rows.
This SECURITY DEFINER function, owned by the schema owner, returns a single aggregate
number across every tenant and nothing else, so caps can be enforced without granting
cross-tenant read access.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

from alembic import context, op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION live_usage_total(k usage_kind, since timestamptz, until timestamptz) RETURNS numeric
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
        $$ SELECT coalesce(sum(quantity), 0) FROM usage_events
           WHERE kind = k AND source = 'live' AND occurred_at >= since AND occurred_at < until $$;
        REVOKE ALL ON FUNCTION live_usage_total(usage_kind, timestamptz, timestamptz) FROM PUBLIC;
    """)
    op.execute(f"GRANT EXECUTE ON FUNCTION live_usage_total(usage_kind, timestamptz, timestamptz) TO {_role()}")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS live_usage_total(usage_kind, timestamptz, timestamptz)")
