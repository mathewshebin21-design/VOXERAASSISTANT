"""Voice lab test sessions (measured latency per turn; no audio or transcript text).

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "voice_test_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("client_session_id", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("stt_provider", sa.String(length=80), nullable=False),
        sa.Column("brain_provider", sa.String(length=80), nullable=False),
        sa.Column("tts_provider", sa.String(length=80), nullable=False),
        sa.Column("turns", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("duration_ms >= 0", name="ck_voice_duration"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "client_session_id", name="uq_voice_session_client_id"),
    )
    op.create_index("ix_voice_test_sessions_organization_id", "voice_test_sessions", ["organization_id"])
    op.create_index("ix_voice_sessions_org_time", "voice_test_sessions", ["organization_id", "started_at"])
    op.execute("""
        ALTER TABLE voice_test_sessions ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON voice_test_sessions USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
    """)
    # Test results are a record: the API role may add and read them, not edit them.
    op.execute(f"GRANT SELECT, INSERT, DELETE ON voice_test_sessions TO {_role()}")


def downgrade() -> None:
    op.execute(f"REVOKE ALL ON voice_test_sessions FROM {_role()}")
    op.drop_table("voice_test_sessions")
