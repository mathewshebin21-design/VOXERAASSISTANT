"""Phase 11 billing storage foundation; no payment transport or charging.

Revision ID: 0014
Revises: 0013

Tenant-scoped, RLS-protected subscription snapshots and append-only event inboxes.
This migration is for disposable database acceptance only until separately approved.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "billing_subscriptions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price_code", sa.String(80), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("price_minor_units", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", name="uq_billing_subscription_org"),
        sa.UniqueConstraint("id", "organization_id", name="uq_billing_subscription_id_org"),
        sa.CheckConstraint("currency IN ('GBP', 'INR')", name="ck_billing_subscription_currency"),
        sa.CheckConstraint("price_minor_units >= 0", name="ck_billing_subscription_price"),
        sa.CheckConstraint(
            "state IN ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')",
            name="ck_billing_subscription_state",
        ),
        sa.CheckConstraint("length(price_code) > 0", name="ck_billing_subscription_price_code"),
    )
    op.create_table(
        "billing_usage_events",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("source_event_id", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("units", sa.BigInteger(), nullable=False),
        sa.Column("synthetic", sa.Boolean(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "organization_id", "provider", "source_event_id", name="uq_billing_usage_source"
        ),
        sa.CheckConstraint("units > 0", name="ck_billing_usage_units"),
        sa.CheckConstraint(
            "kind IN ('call_second', 'stt_second', 'tts_character', 'llm_token', 'notification')",
            name="ck_billing_usage_kind",
        ),
        sa.CheckConstraint("length(provider) > 0 AND length(source_event_id) > 0", name="ck_billing_usage_source"),
    )
    op.create_index("ix_billing_usage_org_time", "billing_usage_events", ["organization_id", "occurred_at"])
    op.create_table(
        "billing_provider_inbox",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("provider_event_id", sa.String(160), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="received"),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", "provider", "provider_event_id", name="uq_billing_provider_event"),
        sa.CheckConstraint("status IN ('received', 'reconciled', 'rejected')", name="ck_billing_provider_status"),
        sa.CheckConstraint(
            "length(provider) > 0 AND length(provider_event_id) > 0", name="ck_billing_provider_identity"
        ),
    )
    role = _role()
    for table in ("billing_subscriptions", "billing_usage_events", "billing_provider_inbox"):
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table}
                USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON billing_subscriptions TO {role}")
    op.execute(f"GRANT SELECT, INSERT ON billing_usage_events TO {role}")
    op.execute(f"GRANT SELECT, INSERT ON billing_provider_inbox TO {role}")


def downgrade() -> None:
    role = _role()
    for table in ("billing_provider_inbox", "billing_usage_events", "billing_subscriptions"):
        op.execute(f"REVOKE ALL ON {table} FROM {role}")
        op.drop_table(table)
