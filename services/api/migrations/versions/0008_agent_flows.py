"""Agent Studio: conversation flows with a mutable draft and immutable published versions.

Revision ID: 0008
Revises: 0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "agent_flows",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.UUID(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("draft", postgresql.JSONB(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("draft_updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("draft_updated_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("published_version", sa.Integer()),
        sa.Column("tests_seeded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_agent_flows_organization_id", "agent_flows", ["organization_id"])
    op.create_table(
        "agent_flow_versions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flow_id", sa.UUID(), sa.ForeignKey("agent_flows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("graph", postgresql.JSONB(), nullable=False),
        sa.Column("note", sa.String(200), nullable=False, server_default=""),
        sa.Column("source", sa.String(20), nullable=False, server_default="publish"),
        sa.Column("restored_from", sa.Integer()),
        sa.Column("validation", postgresql.JSONB(), nullable=False),
        sa.Column("test_report", postgresql.JSONB()),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("flow_id", "version", name="uq_flow_version"),
    )
    op.create_index("ix_agent_flow_versions_organization_id", "agent_flow_versions", ["organization_id"])
    op.create_table(
        "flow_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.UUID(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer()),
        sa.Column("graph", postgresql.JSONB(), nullable=False),
        sa.Column("state", postgresql.JSONB(), nullable=False),
        sa.Column("transcript", postgresql.JSONB(), nullable=False),
        sa.Column("outcome", sa.String(40)),
        sa.Column("ended", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_flow_sessions_org_created", "flow_sessions", ["organization_id", "created_at"])
    op.create_index("ix_flow_sessions_organization_id", "flow_sessions", ["organization_id"])
    op.create_table(
        "flow_tests",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.UUID(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scenario", postgresql.JSONB(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_flow_tests_organization_id", "flow_tests", ["organization_id"])
    role = _role()
    for t in ("agent_flows", "agent_flow_versions", "flow_sessions", "flow_tests"):
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {t} USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON agent_flows TO {role}")
    # Published versions are a record: the API may add them, never change or remove them.
    op.execute(f"GRANT SELECT, INSERT ON agent_flow_versions TO {role}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON flow_sessions TO {role}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON flow_tests TO {role}")


def downgrade() -> None:
    op.drop_table("flow_tests")
    op.drop_table("flow_sessions")
    op.drop_table("agent_flow_versions")
    op.drop_table("agent_flows")
