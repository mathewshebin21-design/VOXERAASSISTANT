"""Reception desk: appointments, shared case queue for multiple employees, desk presence,
the front-desk "staff" role, booking capacity and transfer number.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    # A value can be added inside the migration transaction as long as it isn't used in it.
    op.execute("ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'staff' BEFORE 'viewer'")
    op.add_column(
        "workspace_settings", sa.Column("booking_capacity", sa.SmallInteger(), server_default="1", nullable=False)
    )
    op.add_column("workspace_settings", sa.Column("transfer_phone", sa.String(length=20), nullable=True))
    op.create_check_constraint("ck_settings_capacity", "workspace_settings", "booking_capacity BETWEEN 1 AND 50")

    status = postgresql.ENUM("booked", "cancelled", name="appointment_status", create_type=False)
    kind = postgresql.ENUM("message", "transfer", "callback", name="caller_message_kind", create_type=False)
    mstatus = postgresql.ENUM("new", "in_progress", "resolved", name="caller_message_status", create_type=False)
    desk = postgresql.ENUM("offline", "available", "busy", name="desk_status", create_type=False)
    for e in (status, kind, mstatus, desk):
        e.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "appointments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", sa.UUID(), sa.ForeignKey("services.id", ondelete="SET NULL"), nullable=True),
        sa.Column("service_name", sa.String(120), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocks_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("customer_phone", sa.String(32), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("status", status, nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("idempotency_key", sa.String(160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_appointment_idempotency"),
        sa.CheckConstraint("starts_at < ends_at AND ends_at <= blocks_until", name="ck_appointment_times"),
    )
    op.create_index("ix_appointments_organization_id", "appointments", ["organization_id"])
    op.create_index("ix_appointments_org_time", "appointments", ["organization_id", "starts_at"])
    op.create_index("ix_appointments_org_phone", "appointments", ["organization_id", "customer_phone"])

    op.create_table(
        "caller_messages",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", kind, nullable=False),
        sa.Column("caller_name", sa.String(120), nullable=True),
        sa.Column("caller_phone", sa.String(32), nullable=True),
        sa.Column("summary", sa.String(1000), nullable=False),
        sa.Column("reason", sa.String(200), nullable=True),
        sa.Column("urgent", sa.Boolean(), nullable=False),
        sa.Column("status", mstatus, nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("assigned_to", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(1000), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_caller_messages_organization_id", "caller_messages", ["organization_id"])
    op.create_index("ix_caller_messages_org_time", "caller_messages", ["organization_id", "created_at"])
    op.create_index("ix_caller_messages_org_assignee", "caller_messages", ["organization_id", "assigned_to", "status"])

    op.create_table(
        "case_notes",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_id", sa.UUID(), sa.ForeignKey("caller_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_case_notes_organization_id", "case_notes", ["organization_id"])
    op.create_index("ix_case_notes_case_id", "case_notes", ["case_id"])

    op.create_table(
        "desk_agents",
        sa.Column(
            "organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", desk, nullable=False),
        sa.Column("status_since", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_assigned_at", sa.DateTime(timezone=True), nullable=True),
    )

    role = _role()
    for t in ("appointments", "caller_messages", "case_notes", "desk_agents"):
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {t} USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO {role}")
    op.execute(f"REVOKE UPDATE, DELETE ON case_notes FROM {role}")  # notes are a record


def downgrade() -> None:
    role = _role()
    for t in ("desk_agents", "case_notes", "caller_messages", "appointments"):
        op.execute(f"REVOKE ALL ON {t} FROM {role}")
        op.drop_table(t)
    # member_role keeps its 'staff' value (Postgres cannot drop enum values); nothing may still use it.
    op.execute("UPDATE memberships SET role = 'viewer' WHERE role = 'staff'")
    op.execute("UPDATE invitations SET role = 'viewer' WHERE role = 'staff'")
    for name in ("desk_status", "caller_message_status", "caller_message_kind", "appointment_status"):
        op.execute(f"DROP TYPE IF EXISTS {name}")
    op.drop_constraint("ck_settings_capacity", "workspace_settings", type_="check")
    op.drop_column("workspace_settings", "transfer_phone")
    op.drop_column("workspace_settings", "booking_capacity")
