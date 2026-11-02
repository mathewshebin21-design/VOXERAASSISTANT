"""Deployment environment marker: which environment a database belongs to.

One row, written only by the schema owner through ``scripts/migrate.py --claim``. The API
role may read it (to refuse a database from the wrong environment) but never change it.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "deployment_environment",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("environment", sa.String(20), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_deployment_environment_single_row"),
        sa.CheckConstraint("environment IN ('production', 'staging')", name="ck_deployment_environment_value"),
    )
    op.execute(f"GRANT SELECT ON deployment_environment TO {_role()}")


def downgrade() -> None:
    op.drop_table("deployment_environment")
