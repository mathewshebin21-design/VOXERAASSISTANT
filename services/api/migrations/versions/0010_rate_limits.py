"""Shared rate limiting: one counter store for every API instance.

The login limiter used to live in each process's memory. On serverless hosting every warm
instance kept its own count, so an attacker spreading attempts across instances got the limit
once per instance. This table holds the counts in Postgres instead, where all instances see them.

Design (sliding-window counter):
- A limit has a bucket (an HMAC of e.g. "login|email|ip", never the raw email or address) and a
  window length. Time is cut into fixed windows of that length; each window has one row.
- One call to ``rate_limit_hit`` adds a hit to the current window with a single upsert, which
  takes the row lock, so simultaneous requests are counted exactly once each and in order. It
  returns this window's count, the previous window's count and how far into the window we are;
  the API estimates the rolling count as previous * (1 - elapsed) + current.
- The database clock decides the window, so instances with skewed clocks still agree.
- Rows expire two windows after they start. Each call deletes a few expired rows (skipping
  locked ones), so the table stays small without a scheduled job.

The API role cannot read or change the table directly: it may only call the function, which
validates its arguments. Nothing here is tenant data (limits apply before sign-in), so no RLS.

Revision ID: 0010
Revises: 0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> str:
    role = context.get_x_argument(as_dictionary=True).get("app_role", "voxera_app")
    if not role.replace("_", "").isalnum():
        raise ValueError("invalid app_role")
    return role


def upgrade() -> None:
    op.create_table(
        "rate_limit_hits",
        sa.Column("bucket", sa.String(64), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("bucket", "window_start", name="pk_rate_limit_hits"),
        sa.CheckConstraint("hits > 0", name="ck_rate_limit_hits"),
    )
    op.create_index("ix_rate_limit_expires", "rate_limit_hits", ["expires_at"])
    op.execute("""
        CREATE FUNCTION rate_limit_hit(p_bucket text, p_window integer)
        RETURNS TABLE (current_hits integer, previous_hits integer, elapsed double precision)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        DECLARE
            t timestamptz := clock_timestamp();
            w interval;
            w_start timestamptz;
        BEGIN
            IF p_bucket IS NULL OR p_bucket !~ '^[a-z0-9_:-]{1,64}$' OR p_window IS NULL
               OR p_window < 1 OR p_window > 86400 THEN
                RAISE EXCEPTION 'rate_limit_hit: invalid bucket or window' USING ERRCODE = '22023';
            END IF;
            w := make_interval(secs => p_window);
            w_start := to_timestamp(floor(extract(epoch FROM t) / p_window) * p_window);

            INSERT INTO rate_limit_hits AS r (bucket, window_start, hits, expires_at)
            VALUES (p_bucket, w_start, 1, w_start + 2 * w)
            ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
            RETURNING r.hits INTO current_hits;

            SELECT coalesce(max(h.hits), 0) INTO previous_hits
            FROM rate_limit_hits h WHERE h.bucket = p_bucket AND h.window_start = w_start - w;

            elapsed := extract(epoch FROM t - w_start) / p_window;

            DELETE FROM rate_limit_hits WHERE ctid IN (
                SELECT ctid FROM rate_limit_hits WHERE expires_at < t LIMIT 50 FOR UPDATE SKIP LOCKED
            );
            RETURN NEXT;
        END $$;
        REVOKE ALL ON FUNCTION rate_limit_hit(text, integer) FROM PUBLIC;
    """)
    role = _role()
    op.execute(f"REVOKE ALL ON rate_limit_hits FROM {role}")
    op.execute(f"GRANT EXECUTE ON FUNCTION rate_limit_hit(text, integer) TO {role}")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS rate_limit_hit(text, integer)")
    op.drop_table("rate_limit_hits")
