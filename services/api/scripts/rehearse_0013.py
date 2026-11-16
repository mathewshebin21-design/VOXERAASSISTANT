"""Rehearse 0013 on a dedicated, disposable loopback PostgreSQL database.

CI creates voxera_migration_rehearsal in its Postgres service. This script
uses fixed synthetic credentials and does not accept hosted connection URLs.
"""
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from verify_release import owner_checks, runtime_checks

DATABASE = "voxera_migration_rehearsal"
OWNER_URL = f"postgresql+psycopg://voxera_owner:owner-dev-only@127.0.0.1:5432/{DATABASE}"
RUNTIME_URL = f"postgresql+psycopg://voxera_app:app-dev-only@127.0.0.1:5432/{DATABASE}"


class InjectedRollback(Exception):
    """Simulate an interrupted transaction after 0013 finished its DDL."""


def verify(engine, revision, existing):
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        results, counts, tenant = owner_checks(conn, "staging", revision)
        actual = conn.execute(
            text("SELECT id, organization_id, summary, status FROM caller_messages ORDER BY id")
        ).all()
    assert actual == existing
    assert counts["caller_messages"] == 2
    results += runtime_checks(RUNTIME_URL, tenant)
    assert all(ok for _, ok, _ in results), [name for name, ok, _ in results if not ok]
    if revision == "0012":
        assert "staff_notification_outbox" not in counts
        assert "staff_notification_attempts" not in counts
    else:
        assert counts["staff_notification_outbox"] == counts["staff_notification_attempts"] == 0
    print(f"Schema {revision}: {len(results)} checks passed, seeded cases retained")


def main():
    engine = create_engine(OWNER_URL, connect_args={"connect_timeout": 5})
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", OWNER_URL)
    try:
        with engine.connect() as conn:
            identity = conn.execute(text("SELECT current_database(), current_user")).one()
            if tuple(identity) != (DATABASE, "voxera_owner"):
                raise RuntimeError("Refusing unexpected rehearsal database or user")
            if conn.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).scalar_one():
                raise RuntimeError("The rehearsal requires a fresh database")

        command.upgrade(cfg, "0012")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO deployment_environment (id, environment) VALUES (1, 'staging')"))
            for name in ("Synthetic A", "Synthetic B"):
                org = uuid4()
                conn.execute(text("INSERT INTO organizations (id, name) VALUES (:id, :name)"), {"id": org, "name": name})
                conn.execute(
                    text(
                        "INSERT INTO caller_messages (id, organization_id, kind, summary, urgent, status, source) "
                        "VALUES (:id, :org, 'message', :summary, false, 'new', 'ai_receptionist')"
                    ),
                    {"id": uuid4(), "org": org, "summary": name},
                )
            existing = conn.execute(
                text("SELECT id, organization_id, summary, status FROM caller_messages ORDER BY id")
            ).all()
        verify(engine, "0012", existing)

        try:
            with engine.begin() as conn:
                cfg.attributes["connection"] = conn
                command.upgrade(cfg, "0013")
                assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
                raise InjectedRollback
        except InjectedRollback:
            print("Simulated interruption rolled back the migration transaction")
        finally:
            cfg.attributes.pop("connection", None)
        verify(engine, "0012", existing)

        command.upgrade(cfg, "0013")
        verify(engine, "0013", existing)
        command.upgrade(cfg, "0013")
        verify(engine, "0013", existing)

        # Only this disposable database may exercise downgrade of the new tables.
        command.downgrade(cfg, "0012")
        verify(engine, "0012", existing)
        command.upgrade(cfg, "0013")
        verify(engine, "0013", existing)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
