"""Database acceptance for Phase 11 migration 0014 on disposable CI PostgreSQL."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _insert_usage(conn, org_id, source="event-1"):
    conn.execute(
        text(
            "INSERT INTO billing_usage_events "
            "(id, organization_id, provider, source_event_id, kind, units, synthetic, occurred_at) "
            "VALUES (:id, :org, 'fake', :source, 'call_second', 60, true, :at)"
        ),
        {"id": uuid.uuid4(), "org": org_id, "source": source, "at": datetime.now(UTC)},
    )


def test_billing_usage_is_tenant_isolated(make_account, app_engine):
    a = make_account("billing-rls-a@example.com")
    b = make_account("billing-rls-b@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        _insert_usage(conn, a.org_id)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0
        with pytest.raises(DBAPIError):
            _insert_usage(conn, a.org_id)


def test_billing_usage_replay_is_rejected_by_unique_index(make_account, app_engine):
    a = make_account("billing-unique@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        _insert_usage(conn, a.org_id, "unique-1")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(DBAPIError):
            _insert_usage(conn, a.org_id, "unique-1")


def test_billing_usage_app_role_cannot_mutate_ledger(make_account, app_engine):
    a = make_account("billing-immutable@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        _insert_usage(conn, a.org_id, "immutable-1")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(DBAPIError):
            conn.execute(text("UPDATE billing_usage_events SET units = 999"))
