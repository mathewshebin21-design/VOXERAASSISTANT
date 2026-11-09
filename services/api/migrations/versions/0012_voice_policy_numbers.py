"""Per-workspace voice policy, and which telephone numbers belong to which workspace.

- ``voice_policies``: one row per workspace (optional; a workspace without a row uses the defaults
  in ``app/voice/routing.py``). The languages the receptionist may speak, the default and fallback
  language, the regions where providers may process data, blocked and preferred providers, and
  whether paid or unverified providers may be used. It replaces policy passed per request or set
  in the worker's environment. Owners and admins edit it through the API.
- ``phone_numbers``: the telephone numbers (E.164) that reach a workspace. A number belongs to at
  most one workspace (globally unique). The runtime role may only **read** its own workspace's
  numbers: numbers are assigned by an operator (``scripts/phone_numbers.py`` with the owner
  connection), never through the API, so no workspace can claim a number that reaches another
  business. A telephone call is recorded only for a number that is active for the workspace named
  in the worker's token.

Both are tenant tables with row-level security. Nothing here enables telephony.

Revision ID: 0012
Revises: 0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REGIONS = "ARRAY['device', 'uk', 'eu', 'us', 'global']::varchar[]"
LOCALE = r"'^[a-z]{2,3}-[A-Z]{2}$'"
E164 = r"'^\+[1-9][0-9]{6,14}$'"


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def _text_array(name: str, default: str) -> sa.Column:
    return sa.Column(name, postgresql.ARRAY(sa.String(32)), server_default=sa.text(default), nullable=False)


def upgrade() -> None:
    op.create_table(
        "voice_policies",
        sa.Column(
            "organization_id",
            sa.UUID(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("default_language", sa.String(16), server_default="en-GB", nullable=False),
        _text_array("languages", "ARRAY['en-GB']::varchar[]"),
        sa.Column("fallback_language", sa.String(16), server_default="en-GB", nullable=True),
        _text_array("allowed_regions", f"{REGIONS}"),
        _text_array("blocked_providers", "ARRAY[]::varchar[]"),
        _text_array("preferred_providers", "ARRAY[]::varchar[]"),
        sa.Column("allow_paid", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("allow_unverified", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(f"default_language ~ {LOCALE}", name="ck_voice_policy_default_locale"),
        sa.CheckConstraint(
            "cardinality(languages) BETWEEN 1 AND 20 AND default_language = ANY(languages)",
            name="ck_voice_policy_languages",
        ),
        sa.CheckConstraint(
            "fallback_language IS NULL OR fallback_language = ANY(languages)", name="ck_voice_policy_fallback"
        ),
        sa.CheckConstraint(
            f"cardinality(allowed_regions) >= 1 AND allowed_regions <@ {REGIONS}", name="ck_voice_policy_regions"
        ),
        sa.CheckConstraint(
            "cardinality(blocked_providers) <= 20 AND cardinality(preferred_providers) <= 20",
            name="ck_voice_policy_provider_lists",
        ),
    )

    op.create_table(
        "phone_numbers",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("e164", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), server_default="active", nullable=False),
        sa.Column("label", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("e164", name="uq_phone_number_e164"),  # one number, one workspace
        sa.CheckConstraint(f"e164 ~ {E164}", name="ck_phone_number_e164"),
        sa.CheckConstraint("status IN ('active', 'disabled')", name="ck_phone_number_status"),
    )
    op.create_index("ix_phone_numbers_org", "phone_numbers", ["organization_id"])

    role = _role()
    for t in ("voice_policies", "phone_numbers"):
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {t} USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON voice_policies TO {role}")
    op.execute(f"GRANT SELECT ON phone_numbers TO {role}")  # assigned by an operator only


def downgrade() -> None:
    role = _role()
    for t in ("phone_numbers", "voice_policies"):
        op.execute(f"REVOKE ALL ON {t} FROM {role}")
        op.drop_table(t)
