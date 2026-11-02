"""Usage reservations: enforceable monthly caps on live (billable) provider usage.

Before a live provider call, the API reserves the most that call can consume. Reserving
takes a transaction-level advisory lock per usage kind, counts recorded usage plus every
open reservation (in this workspace and across all workspaces), and only then inserts the
reservation, so simultaneous requests can no longer each pass the check and together go
over the cap. When the call ends, the reservation is replaced by the actual usage in one
transaction. A reservation that is never settled (a crashed worker) keeps counting at its
worst case, which fails safe: the cap is under-used, never exceeded.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "live_reservations",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", postgresql.ENUM(name="usage_kind", create_type=False), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_reservation_key"),
        sa.CheckConstraint("quantity > 0", name="ck_reservation_quantity"),
    )
    op.create_index("ix_reservation_org_kind", "live_reservations", ["organization_id", "kind"])
    role = _role()
    op.execute("""
        ALTER TABLE live_reservations ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON live_reservations
            USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
    """)
    op.execute(f"GRANT SELECT, INSERT, DELETE ON live_reservations TO {role}")
    # Like live_usage_total: one aggregate across every tenant, nothing else.
    op.execute("""
        CREATE FUNCTION live_reserved_total(k usage_kind) RETURNS numeric
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
        $$ SELECT coalesce(sum(quantity), 0) FROM live_reservations WHERE kind = k $$;
        REVOKE ALL ON FUNCTION live_reserved_total(usage_kind) FROM PUBLIC;
    """)
    op.execute(f"GRANT EXECUTE ON FUNCTION live_reserved_total(usage_kind) TO {role}")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS live_reserved_total(usage_kind)")
    op.drop_table("live_reservations")
