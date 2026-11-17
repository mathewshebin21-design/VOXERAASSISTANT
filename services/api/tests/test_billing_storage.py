"""Database acceptance for Phase 11 migration 0014 on disposable CI PostgreSQL."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.billing_storage import record_synthetic_usage
from app.billing_usage import UsageEvent, UsageKind, UsageReplayConflict


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


def test_subscription_and_provider_inbox_are_tenant_isolated(make_account, app_engine):
    a = make_account("billing-subscription-a@example.com")
    b = make_account("billing-subscription-b@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        conn.execute(
            text(
                "INSERT INTO billing_subscriptions "
                "(id, organization_id, price_code, currency, price_minor_units, state, effective_at) "
                "VALUES (:id, :org, 'uk-basic-v1', 'GBP', 2900, 'trialing', :at)"
            ),
            {"id": uuid.uuid4(), "org": a.org_id, "at": datetime.now(UTC)},
        )
        conn.execute(
            text(
                "INSERT INTO billing_provider_inbox "
                "(id, organization_id, provider, provider_event_id) "
                "VALUES (:id, :org, 'fake', 'payment-1')"
            ),
            {"id": uuid.uuid4(), "org": a.org_id},
        )
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        assert conn.execute(text("SELECT count(*) FROM billing_subscriptions")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0


def test_provider_inbox_rejects_replayed_event(make_account, app_engine):
    a = make_account("billing-inbox-replay@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        conn.execute(
            text(
                "INSERT INTO billing_provider_inbox "
                "(id, organization_id, provider, provider_event_id) "
                "VALUES (:id, :org, 'fake', 'replay-1')"
            ),
            {"id": uuid.uuid4(), "org": a.org_id},
        )
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(DBAPIError):
            conn.execute(
                text(
                    "INSERT INTO billing_provider_inbox "
                    "(id, organization_id, provider, provider_event_id) "
                    "VALUES (:id, :org, 'fake', 'replay-1')"
                ),
                {"id": uuid.uuid4(), "org": a.org_id},
            )


def test_atomic_synthetic_usage_insert_and_exact_replay(make_account, app_engine):
    a = make_account("billing-atomic@example.com")
    event = UsageEvent(a.org_id, "atomic-1", UsageKind.CALL_SECOND, 60, True, "fake")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert record_synthetic_usage(conn, event) is True
        assert record_synthetic_usage(conn, event) is False
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 1


def test_atomic_synthetic_usage_rejects_conflicting_replay(make_account, app_engine):
    a = make_account("billing-atomic-conflict@example.com")
    event = UsageEvent(a.org_id, "atomic-2", UsageKind.CALL_SECOND, 60, True, "fake")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert record_synthetic_usage(conn, event) is True
        with pytest.raises(UsageReplayConflict):
            record_synthetic_usage(conn, UsageEvent(a.org_id, "atomic-2", UsageKind.CALL_SECOND, 61, True, "fake"))


def test_atomic_writer_refuses_real_usage(make_account, app_engine):
    a = make_account("billing-atomic-real@example.com")
    event = UsageEvent(a.org_id, "atomic-3", UsageKind.CALL_SECOND, 60, False, "fake")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(PermissionError):
            record_synthetic_usage(conn, event)
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0


def test_atomic_writer_respects_authenticated_tenant_rls(make_account, app_engine):
    a = make_account("billing-atomic-tenant-a@example.com")
    b = make_account("billing-atomic-tenant-b@example.com")
    foreign = UsageEvent(a.org_id, "foreign-1", UsageKind.CALL_SECOND, 60, True, "fake")
    with pytest.raises(PermissionError), app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        record_synthetic_usage(conn, foreign)
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0


def test_atomic_writer_rejects_naive_timestamps(make_account, app_engine):
    a = make_account("billing-atomic-timestamp@example.com")
    event = UsageEvent(a.org_id, "naive-1", UsageKind.CALL_SECOND, 60, True, "fake")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(ValueError):
            record_synthetic_usage(conn, event, occurred_at=datetime(2026, 11, 17))
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0


def test_atomic_writer_requires_tenant_context(make_account, app_engine):
    a = make_account("billing-atomic-missing-context@example.com")
    event = UsageEvent(a.org_id, "missing-tenant-1", UsageKind.CALL_SECOND, 60, True, "fake")
    with app_engine.begin() as conn:
        with pytest.raises(PermissionError):
            record_synthetic_usage(conn, event)
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 0


def test_concurrent_identical_synthetic_usage_commits_once(make_account, app_engine):
    a = make_account("billing-atomic-concurrent@example.com")
    event = UsageEvent(a.org_id, "concurrent-1", UsageKind.CALL_SECOND, 60, True, "fake")
    barrier = Barrier(2, timeout=15)

    def submit():
        with app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
            barrier.wait()
            return record_synthetic_usage(conn, event)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit)
        second = pool.submit(submit)
        assert sorted([first.result(timeout=25), second.result(timeout=25)]) == [False, True]
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert conn.execute(text("SELECT count(*) FROM billing_usage_events")).scalar_one() == 1
