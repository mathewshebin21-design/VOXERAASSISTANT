"""Durable, tenant-isolated staff-notification outbox; transport remains disabled.

Revision ID: 0013
Revises: 0012

The queued record holds only a pointer to a case, NEVER caller text/phone/email.
A separate append-only attempt table records scheduling and transport outcomes.
An accepted provider request is not a delivered notification or staff response.
No email/SMS/push worker or provider credentials are installed by this migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ("pending", "leased", "retry", "provider_accepted", "delivered", "dead", "cancelled")
RESULTS = ("reserved", "accepted", "retry", "dead")


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    # A composite FK ensures a queue row can never point into another tenant.
    op.create_unique_constraint("uq_caller_message_id_org", "caller_messages", ["id", "organization_id"])
    op.create_table(
        "staff_notification_outbox",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_id", sa.UUID(), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("lease_token", sa.UUID(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_ref", sa.String(120), nullable=True),
        sa.Column("provider_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(48), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id", "organization_id"],
            ["caller_messages.id", "caller_messages.organization_id"],
            name="fk_staff_notification_case_same_org",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "organization_id", name="uq_staff_notification_id_org"),
        sa.UniqueConstraint("case_id", "channel", name="uq_staff_notification_once_per_case_channel"),
        sa.CheckConstraint("channel = 'staff_email'", name="ck_staff_notification_channel"),
        sa.CheckConstraint("status IN (" + ", ".join(repr(s) for s in STATUSES) + ")", name="ck_staff_notification_status"),
        sa.CheckConstraint("attempts >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempts <= max_attempts",
                           name="ck_staff_notification_attempts"),
        sa.CheckConstraint(
            "(status = 'leased') = (lease_until IS NOT NULL)",
            name="ck_staff_notification_lease_state",
        ),
        sa.CheckConstraint("delivered_at IS NULL OR provider_accepted_at IS NOT NULL",
                           name="ck_staff_notification_delivered_requires_acceptance"),
    )
    op.create_index(
        "ix_staff_notification_due",
        "staff_notification_outbox",
        ["organization_id", "status", "next_attempt_at"],
    )
    op.create_table(
        "staff_notification_attempts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notification_id", sa.UUID(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(48), nullable=True),
        sa.Column("provider_ref", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["notification_id", "organization_id"],
            ["staff_notification_outbox.id", "staff_notification_outbox.organization_id"],
            name="fk_staff_notification_attempt_same_org",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "notification_id", "attempt_number", "result", name="uq_staff_notification_attempt_stage"
        ),
        sa.CheckConstraint("attempt_number > 0", name="ck_staff_notification_attempt_number"),
        sa.CheckConstraint("result IN (" + ", ".join(repr(r) for r in RESULTS) + ")",
                           name="ck_staff_notification_attempt_result"),
    )
    op.create_index("ix_staff_notification_attempt_order", "staff_notification_attempts",
                    ["notification_id", "attempt_number", "created_at"])

    role = _role()
    for table in ("staff_notification_outbox", "staff_notification_attempts"):
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table}
                USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON staff_notification_outbox TO {role}")
    op.execute(f"GRANT SELECT, INSERT ON staff_notification_attempts TO {role}")


def downgrade() -> None:
    role = _role()
    op.execute(f"REVOKE ALL ON staff_notification_attempts FROM {role}")
    op.execute(f"REVOKE ALL ON staff_notification_outbox FROM {role}")
    op.drop_table("staff_notification_attempts")
    op.drop_table("staff_notification_outbox")
    op.drop_constraint("uq_caller_message_id_org", "caller_messages", type_="unique")
