"""Add raw payload digest for tenant-scoped provider event replay checks.

Revision ID: 0015
Revises: 0014

Legacy inbox rows cannot be reconstructed from a provider event ID alone.
Keep their digest NULL and reject ambiguous replays in the writer.
Disposable CI migration rehearsal only until separately approved.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.add_column("billing_provider_inbox", sa.Column("payload_sha256", sa.String(64), nullable=True))
    op.execute(f"GRANT UPDATE ON billing_provider_inbox TO {_role()}")
    op.create_check_constraint(
        "ck_billing_provider_payload_digest",
        "billing_provider_inbox",
        "payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'",
    )


def downgrade() -> None:
    op.execute(f"REVOKE UPDATE ON billing_provider_inbox FROM {_role()}")
    op.drop_constraint("ck_billing_provider_payload_digest", "billing_provider_inbox", type_="check")
    op.drop_column("billing_provider_inbox", "payload_sha256")
