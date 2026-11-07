"""Interface design preference: a workspace default and an optional per-member override.

Revision ID 0009 (not 0008): revision 0008 already exists on the Agent Studio branch and is applied
to shared staging. This migration follows Agent Studio revision 0008 in a linear chain.

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DESIGNS = "ui_design IN ('command', 'atelier', 'flow')"


def upgrade() -> None:
    # Existing workspaces get the default; existing members follow it (NULL = no override).
    op.add_column(
        "workspace_settings",
        sa.Column("ui_design", sa.String(16), server_default="atelier", nullable=False),
    )
    op.create_check_constraint("ck_settings_ui_design", "workspace_settings", DESIGNS)
    op.add_column("memberships", sa.Column("ui_design", sa.String(16), nullable=True))
    op.create_check_constraint("ck_membership_ui_design", "memberships", DESIGNS)


def downgrade() -> None:
    op.drop_constraint("ck_membership_ui_design", "memberships", type_="check")
    op.drop_column("memberships", "ui_design")
    op.drop_constraint("ck_settings_ui_design", "workspace_settings", type_="check")
    op.drop_column("workspace_settings", "ui_design")
