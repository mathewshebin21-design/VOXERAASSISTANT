"""Add raw payload digest for tenant-scoped provider event replay checks.

Revision ID: 0015
Revises: 0014

Legacy inbox rows cannot be reconstructed from a provider event ID alone.
Keep their digest NULL and reject ambiguous replays in the writer.
Disposable CI migration rehearsal only until separately approved.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("billing_provider_inbox", sa.Column("payload_sha256", sa.String(64), nullable=True))
    op.create_check_constraint(
        "ck_billing_provider_payload_digest",
        "billing_provider_inbox",
        "payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_billing_provider_payload_digest", "billing_provider_inbox", type_="check")
    op.drop_column("billing_provider_inbox", "payload_sha256")
