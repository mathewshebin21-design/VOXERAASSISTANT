"""Call records: one row per receptionist call, with an append-only event log (the transcript).

- ``calls``: one row per call. Holds its channel (simulated, web or phone), lifecycle
  (in_progress → completed / failed / abandoned), outcome, the caller's number and name, and
  which notices were played. A call is in progress exactly while ``ended_at`` is NULL. Audio
  is never stored: ``audio_stored`` must be false until a separately approved migration
  allows recording.
- ``call_events``: what happened, in order (``seq`` is unique per call): utterances by caller
  and agent, tool calls, hand-offs, errors. The API role may only add and read events, never
  change or delete them. They go only when their call is deleted (retention, an erasure
  request, or deleting the workspace).
- ``call_housekeeping(limit)``: a SECURITY DEFINER function for a scheduled job. It deletes calls
  older than their workspace's retention period (``recording_retention_days``, 7–365, so a
  shorter setting also applies to existing calls), and marks calls with no activity for two
  hours as abandoned. It returns counts only.

Both tables are tenant tables with row-level security, like every other.

Revision ID: 0011
Revises: 0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHANNELS = "channel IN ('simulated', 'web', 'phone')"
STATUSES = "status IN ('in_progress', 'completed', 'failed', 'abandoned')"
OUTCOMES = (
    "outcome IS NULL OR outcome IN ('booked', 'rescheduled', 'cancelled', 'message_taken', 'transferred', "
    "'answered', 'emergency', 'no_action')"
)
KINDS = "kind IN ('utterance', 'tool', 'handoff', 'system', 'error')"
SPEAKERS = "speaker IS NULL OR speaker IN ('caller', 'agent', 'system')"


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "calls",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=True),
        sa.Column("external_ref", sa.String(64), nullable=True),
        sa.Column("caller_number", sa.String(32), nullable=True),
        sa.Column("caller_name", sa.String(120), nullable=True),
        sa.Column("ai_disclosure_played", sa.Boolean(), nullable=False),
        sa.Column("recording_notice_played", sa.Boolean(), nullable=False),
        sa.Column("transcript_retained", sa.Boolean(), nullable=False),
        sa.Column("audio_stored", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("event_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("summary", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("end_reason", sa.String(200), nullable=True),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "external_ref", name="uq_call_external_ref"),
        sa.CheckConstraint(CHANNELS, name="ck_call_channel"),
        sa.CheckConstraint(STATUSES, name="ck_call_status"),
        sa.CheckConstraint(OUTCOMES, name="ck_call_outcome"),
        sa.CheckConstraint("(status = 'in_progress') = (ended_at IS NULL)", name="ck_call_lifecycle"),
        sa.CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ck_call_times"),
        sa.CheckConstraint("audio_stored = false", name="ck_call_no_audio"),
        sa.CheckConstraint("event_count >= 0", name="ck_call_event_count"),
    )
    op.create_index("ix_calls_org_started", "calls", ["organization_id", sa.text("started_at DESC")])
    op.create_index("ix_calls_started", "calls", ["started_at"])
    op.create_index(
        "ix_calls_open_activity", "calls", ["last_activity_at"], postgresql_where=sa.text("status = 'in_progress'")
    )

    op.create_table(
        "call_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("call_id", sa.UUID(), sa.ForeignKey("calls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("speaker", sa.String(8), nullable=True),
        sa.Column("text", sa.String(4000), nullable=True),
        sa.Column("data", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.UniqueConstraint("call_id", "seq", name="uq_call_event_seq"),
        sa.CheckConstraint(KINDS, name="ck_call_event_kind"),
        sa.CheckConstraint(SPEAKERS, name="ck_call_event_speaker"),
        sa.CheckConstraint("seq > 0", name="ck_call_event_seq"),
    )
    op.create_index("ix_call_events_org", "call_events", ["organization_id"])

    role = _role()
    for t in ("calls", "call_events"):
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {t} USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
        """)
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON calls TO {role}")
    op.execute(f"GRANT SELECT, INSERT ON call_events TO {role}")  # the transcript is a record

    op.execute("""
        CREATE FUNCTION call_housekeeping(p_limit integer)
        RETURNS TABLE (purged integer, abandoned integer)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        BEGIN
            IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
                RAISE EXCEPTION 'call_housekeeping: invalid limit' USING ERRCODE = '22023';
            END IF;
            WITH expired AS (
                SELECT c.id FROM calls c
                JOIN workspace_settings s ON s.organization_id = c.organization_id
                WHERE c.started_at < now() - make_interval(days => s.recording_retention_days)
                ORDER BY c.started_at LIMIT p_limit
            )
            DELETE FROM calls WHERE id IN (SELECT id FROM expired);
            GET DIAGNOSTICS purged = ROW_COUNT;
            UPDATE calls SET status = 'abandoned', ended_at = greatest(last_activity_at, started_at),
                             end_reason = 'No activity for two hours'
            WHERE id IN (
                SELECT id FROM calls WHERE status = 'in_progress' AND last_activity_at < now() - interval '2 hours'
                ORDER BY last_activity_at LIMIT p_limit
            );
            GET DIAGNOSTICS abandoned = ROW_COUNT;
            RETURN NEXT;
        END $$;
        REVOKE ALL ON FUNCTION call_housekeeping(integer) FROM PUBLIC;
    """)
    op.execute(f"GRANT EXECUTE ON FUNCTION call_housekeeping(integer) TO {role}")


def downgrade() -> None:
    role = _role()
    op.execute("DROP FUNCTION IF EXISTS call_housekeeping(integer)")
    for t in ("call_events", "calls"):
        op.execute(f"REVOKE ALL ON {t} FROM {role}")
        op.drop_table(t)
