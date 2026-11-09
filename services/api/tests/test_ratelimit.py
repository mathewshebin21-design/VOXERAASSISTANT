"""Shared (Postgres) rate limiter: atomic counting across instances, expiry, privacy and failing closed."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.ratelimit import Decision, LimiterUnavailable, PostgresLimiter, SlidingWindowLimiter, make_limiter
from app.routers import auth
from tests.conftest import APP_URL

SECRET = b"test-rate-limit-secret"


def _limiter(engine, limit=5, window=60, name="t"):
    return PostgresLimiter(engine, name, limit, window, SECRET)


def test_exactly_the_limit_is_allowed_under_concurrency_across_instances(app_engine):
    # Two engines stand in for two serverless instances, each with its own connection pool.
    other = create_engine(APP_URL, pool_size=10)
    try:
        instances = [_limiter(app_engine, limit=5), _limiter(other, limit=5)]
        barrier = threading.Barrier(20)

        def attempt(i: int) -> bool:
            barrier.wait()
            return instances[i % 2].check("ada@example.com|203.0.113.7").allowed

        with ThreadPoolExecutor(20) as pool:
            results = list(pool.map(attempt, range(20)))
    finally:
        other.dispose()
    assert sum(results) == 5


def test_hits_are_counted_once_each_and_in_order(app_engine):
    lim = _limiter(app_engine)
    assert [lim.hit("k")[0] for _ in range(4)] == [1, 2, 3, 4]


def test_keys_and_limits_do_not_share_counts(app_engine):
    a, b = _limiter(app_engine, limit=1), _limiter(app_engine, limit=1, name="other")
    assert a.check("one").allowed and not a.check("one").allowed
    assert a.check("two").allowed  # another key
    assert b.check("one").allowed  # another limiter with the same key


def test_previous_window_still_counts_while_it_overlaps(app_engine, owner_engine):
    lim = _limiter(app_engine, limit=5, window=3600)
    bucket = lim.bucket("k")
    with owner_engine.begin() as c:  # five attempts in the previous hour-window
        c.execute(
            text(
                "INSERT INTO rate_limit_hits VALUES (:b, to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600)"
                " - interval '1 hour', 5, now() + interval '1 hour')"
            ),
            {"b": bucket},
        )
    current, previous, elapsed = lim.hit("k")
    assert (current, previous) == (1, 5) and 0.0 <= elapsed <= 1.0
    assert lim.decide(current, previous, elapsed).allowed == (5 * (1 - elapsed) + 1 <= 5)


@pytest.mark.parametrize(
    ("current", "previous", "elapsed", "allowed", "retry_after"),
    [
        (5, 0, 0.5, True, 0),  # exactly at the limit
        (6, 0, 0.5, False, 90),  # this window alone is over: wait for it to slide out
        (1, 10, 0.2, False, 24),  # the previous window's share falls to 4 at elapsed 0.6
        (1, 10, 0.7, True, 0),  # 10 * 0.3 + 1 = 4
    ],
)
def test_sliding_window_estimate(app_engine, current, previous, elapsed, allowed, retry_after):
    d = _limiter(app_engine, limit=5, window=60).decide(current, previous, elapsed)
    assert d == Decision(allowed, retry_after)


def test_expired_windows_are_removed(app_engine, owner_engine):
    with owner_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO rate_limit_hits VALUES ('old', now() - interval '2 hours', 3, now() - interval '1 hour'),"
                " ('fresh', now(), 1, now() + interval '1 hour')"
            )
        )
    _limiter(app_engine).hit("k")
    with owner_engine.connect() as c:
        left = set(c.execute(text("SELECT bucket FROM rate_limit_hits")).scalars())
    assert "old" not in left and "fresh" in left


def test_the_api_role_can_only_call_the_function(app_engine):
    for sql in (
        "SELECT * FROM rate_limit_hits",
        "INSERT INTO rate_limit_hits VALUES ('x', now(), 1, now())",
        "DELETE FROM rate_limit_hits",
    ):
        with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
            c.execute(text(sql))


@pytest.mark.parametrize(("bucket", "window"), [("UPPER", 60), ("x" * 65, 60), ("ok", 0), ("ok", 86401)])
def test_the_function_rejects_bad_arguments(app_engine, bucket, window):
    with pytest.raises(DBAPIError, match="invalid bucket or window"), app_engine.begin() as c:
        c.execute(text("SELECT * FROM rate_limit_hit(:b, :w)"), {"b": bucket, "w": window})


def test_no_email_or_address_is_stored(client, make_account, owner_engine):
    make_account("ada@example.com")
    client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "wrong password"})
    with owner_engine.connect() as c:
        buckets = list(c.execute(text("SELECT bucket FROM rate_limit_hits")).scalars())
    # One per-address bucket and one per-email bucket; both are digests, never the email itself.
    assert len(buckets) == 2 and all(len(b) == 64 and "ada" not in b for b in buckets)


def test_login_429_says_when_to_retry(client, make_account):
    make_account("ada@example.com")
    for _ in range(5):
        client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "wrong password"})
    r = client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "correct horse battery staple"})
    assert r.status_code == 429 and 1 <= int(r.headers["retry-after"]) <= 120


def test_unreachable_store_fails_closed(monkeypatch, client, make_account):
    make_account("ada@example.com")
    broken = create_engine("postgresql+psycopg://nobody:wrong@127.0.0.1:9/none", connect_args={"connect_timeout": 1})
    with pytest.raises(LimiterUnavailable):
        _limiter(broken).check("k")
    monkeypatch.setattr(auth, "login_limiter", _limiter(broken))
    r = client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "correct horse battery staple"})
    assert r.status_code == 503 and "access_token" not in r.text


def test_memory_backend_is_the_rollback_setting(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_backend", "memory")
    lim = make_limiter("login", 2, 60)
    assert isinstance(lim, SlidingWindowLimiter)
    assert [lim.check("k").allowed for _ in range(3)] == [True, True, False]
    monkeypatch.setattr(get_settings(), "rate_limit_backend", "postgres")
    assert isinstance(make_limiter("login", 2, 60), PostgresLimiter)


def test_migration_0010_downgrades_cleanly_and_upgrades_again(owner_engine):
    import os

    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.environ["VOXERA_MIGRATION_DATABASE_URL"])
    try:
        command.downgrade(cfg, "0009")
        with owner_engine.connect() as c:
            assert c.execute(text("SELECT to_regclass('public.rate_limit_hits')")).scalar() is None
            assert c.execute(text("SELECT count(*) FROM pg_proc WHERE proname = 'rate_limit_hit'")).scalar() == 0
    finally:
        command.upgrade(cfg, "head")
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT to_regclass('public.rate_limit_hits')")).scalar() is not None
