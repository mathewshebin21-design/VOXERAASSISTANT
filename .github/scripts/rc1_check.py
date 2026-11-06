"""Read-only identity check for the dedicated RC-1 database."""
import os
import sys
from rc1_target import validate


def verify_identity(database, tables, marker, revision):
    if database != "neondb":
        raise ValueError("Unexpected database")
    if tables == 0 and marker is None and revision is None:
        return "empty; unclaimed; migrations pending"
    if marker != "staging" or revision != "0007":
        raise ValueError("Database marker or schema does not match RC-1")
    return "staging; schema 0007"


def main():
    connection = os.environ.get("DATABASE_URL_UNPOOLED", "")
    validate(os.environ.get("GITHUB_REF", ""), connection)
    import psycopg
    connection = connection.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(connection, connect_timeout=10, options="-c default_transaction_read_only=on -c statement_timeout=10000", sslmode="require") as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT current_database(), current_setting('transaction_read_only')")
            database, readonly = cursor.fetchone()
            if readonly != "on":
                raise ValueError("Read-only transaction required")
            cursor.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
            tables = cursor.fetchone()[0]
            cursor.execute("SELECT to_regclass('public.deployment_environment'), to_regclass('public.alembic_version')")
            marker_table, revision_table = cursor.fetchone()
            marker = revision = None
            if marker_table:
                cursor.execute("SELECT environment FROM public.deployment_environment WHERE id=1")
                row = cursor.fetchone()
                marker = row[0] if row else None
            if revision_table:
                cursor.execute("SELECT version_num FROM public.alembic_version")
                rows = cursor.fetchall()
                revision = rows[0][0] if len(rows) == 1 else None
            result = verify_identity(database, tables, marker, revision)
            print("RC-1 database verified read-only:", result)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("RC-1 validation refused; target, credential or database identity check failed", file=sys.stderr)
        sys.exit(1)
