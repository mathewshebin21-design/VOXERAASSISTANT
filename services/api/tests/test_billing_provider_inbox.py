"""Disposable PostgreSQL acceptance for tenant-scoped synthetic provider inbox."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text

from app.billing_provider_inbox import record_synthetic_provider_event
from app.billing_provider_replay import ProviderReplayConflict


def _submit(conn, org, body=b'{"id":"evt-1","amount":2900}', event_id="evt-1"):
    return record_synthetic_provider_event(
        conn,
        organization_id=org,
        provider="fake",
        provider_event_id=event_id,
        raw_body=body,
    )


def test_provider_inbox_identical_replay(make_account, app_engine):
    a = make_account("provider-inbox-identical@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert _submit(conn, a.org_id) is True
        assert _submit(conn, a.org_id) is False
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 1


def test_provider_inbox_conflicting_payload_rejected(make_account, app_engine):
    a = make_account("provider-inbox-conflict@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        assert _submit(conn, a.org_id) is True
        with pytest.raises(ProviderReplayConflict):
            _submit(conn, a.org_id, body=b'{"id":"evt-1","amount":3900}')
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 1


def test_provider_inbox_rejects_foreign_tenant(make_account, app_engine):
    a = make_account("provider-inbox-tenant-a@example.com")
    b = make_account("provider-inbox-tenant-b@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": b.org_id})
        with pytest.raises(PermissionError):
            _submit(conn, a.org_id)


def test_provider_inbox_rejects_legacy_digestless_replay(make_account, app_engine):
    a = make_account("provider-inbox-legacy@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        conn.execute(
            text(
                "INSERT INTO billing_provider_inbox (id, organization_id, provider, provider_event_id) "
                "VALUES (gen_random_uuid(), :org, 'fake', 'evt-1')"
            ),
            {"org": a.org_id},
        )
        with pytest.raises(ValueError):
            _submit(conn, a.org_id)


def test_concurrent_provider_replay_inserts_once(make_account, app_engine):
    a = make_account("provider-inbox-concurrent@example.com")
    barrier = Barrier(2, timeout=15)

    def submit():
        with app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
            barrier.wait()
            return _submit(conn, a.org_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit)
        second = pool.submit(submit)
        assert sorted([first.result(timeout=25), second.result(timeout=25)]) == [False, True]


def test_concurrent_conflicting_provider_payload_rejected(make_account, app_engine):
    a = make_account("provider-inbox-concurrent-conflict@example.com")
    barrier = Barrier(2, timeout=15)

    def submit(amount):
        body = ('{"id":"evt-1","amount":' + str(amount) + "}").encode()
        with app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
            barrier.wait()
            return _submit(conn, a.org_id, body=body)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit, amount) for amount in (2900, 3900)]
        results = []
        for future in futures:
            try:
                results.append(future.result(timeout=25))
            except ProviderReplayConflict:
                results.append("conflict")
        assert sorted(results, key=str) == sorted([True, "conflict"], key=str)

@pytest.mark.parametrize("provider", ["stripe", "razorpay", "unknown"])
def test_synthetic_inbox_rejects_non_fake_adapters(make_account, app_engine, provider):
    a = make_account("provider-inbox-nonfake@example.com")
    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": a.org_id})
        with pytest.raises(PermissionError, match="only fake adapters"):
            record_synthetic_provider_event(
                conn, organization_id=a.org_id, provider=provider, provider_event_id="evt-1", raw_body=b"event"
            )
        assert conn.execute(text("SELECT count(*) FROM billing_provider_inbox")).scalar_one() == 0
