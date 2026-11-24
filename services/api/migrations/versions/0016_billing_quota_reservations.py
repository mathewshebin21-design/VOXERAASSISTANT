"""Tenant-scoped quota periods and reservations.

Revision ID: 0016
Revises: 0015

Development migration only; shared/production database migration requires approval.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "billing_quota_periods",
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_key", sa.String(64), nullable=False),
        sa.Column("limit_units", sa.BigInteger(), nullable=False),
        sa.Column("consumed_units", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("reserved_units", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("organization_id", "period_key"),
        sa.CheckConstraint("limit_units >= 0 AND consumed_units >= 0 AND reserved_units >= 0"),
        sa.CheckConstraint("consumed_units + reserved_units <= limit_units", name="ck_billing_quota_within_limit"),
    )
    op.create_table(
        "billing_quota_reservations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("period_key", sa.String(64), nullable=False),
        sa.Column("reservation_id", sa.String(160), nullable=False),
        sa.Column("units", sa.BigInteger(), nullable=False),
        sa.Column("consumed_units", sa.BigInteger(), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id", "period_key"],
            ["billing_quota_periods.organization_id", "billing_quota_periods.period_key"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "organization_id", "period_key", "reservation_id", name="uq_billing_quota_reservation_identity"
        ),
        sa.CheckConstraint("units > 0", name="ck_billing_reservation_units"),
        sa.CheckConstraint(
            "consumed_units IS NULL OR (consumed_units >= 0 AND consumed_units <= units)",
            name="ck_billing_reservation_consumed",
        ),
    )
    role = _role()
    for table in ("billing_quota_periods", "billing_quota_reservations"):
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table}
                USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON billing_quota_periods TO {role}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON billing_quota_reservations TO {role}")


def downgrade() -> None:
    role = _role()
    for table in ("billing_quota_reservations", "billing_quota_periods"):
        op.execute(f"REVOKE ALL ON {table} FROM {role}")
        op.drop_table(table)
