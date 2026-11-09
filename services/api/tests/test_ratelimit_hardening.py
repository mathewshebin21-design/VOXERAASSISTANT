"""Login limits hold when the caller's address keeps changing (production smoke test, 2026-11-09).

Seven wrong passwords for one email landed in six different buckets because the only limit was per
email *and* address, and the address changed between requests. These tests reproduce that: a
per-email limit must stop the guesses whatever addresses they come from, and a forged address
header must never be believed unless our hosting platform is the one that sets it.
"""

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.deps import client_ip

WRONG = {"password": "wrong password"}
RIGHT = {"password": "correct horse battery staple"}


def _login(client, email, body, address=None):
    headers = {"x-vercel-forwarded-for": address} if address else {}
    return client.post("/v1/auth/login", json={"email": email, **body}, headers=headers)


@pytest.fixture
def behind_vercel(monkeypatch):
    """As in production: Vercel sets x-vercel-forwarded-for itself, so it is trusted."""
    monkeypatch.setenv("VERCEL", "1")


@pytest.fixture
def not_behind_a_proxy(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(get_settings(), "client_ip_header", None)


def test_rotating_socket_addresses_cannot_multiply_guesses(not_behind_a_proxy, make_account):
    """The production failure, reproduced: each attempt arrives from a different real address.
    Before the per-email limit, all 15 wrong passwords were answered 401 and none was refused."""
    from fastapi.testclient import TestClient

    from app.main import app

    make_account("ada@example.com")
    codes = []
    for i in range(1, 16):
        with TestClient(app, client=(f"203.0.113.{i}", 50000)) as c:
            codes.append(_login(c, "ada@example.com", WRONG).status_code)
    assert codes[:10] == [401] * 10 and set(codes[10:]) == {429}


def test_rotating_addresses_cannot_multiply_password_guesses(behind_vercel, client, make_account):
    make_account("ada@example.com")
    codes = [_login(client, "ada@example.com", WRONG, f"203.0.113.{i}").status_code for i in range(1, 16)]
    # Every attempt came from a new address, so the per-address limit never fills up; the per-email
    # limit (10 in 15 minutes) must stop the guessing anyway.
    assert codes[:10] == [401] * 10 and set(codes[10:]) == {429}
    r = _login(client, "ada@example.com", RIGHT, "203.0.113.99")
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 60  # even the right password waits


def test_one_locked_email_does_not_lock_anyone_else(behind_vercel, client, make_account):
    make_account("ada@example.com")
    make_account("bob@example.com")
    for i in range(12):
        _login(client, "ada@example.com", WRONG, f"198.51.100.{i}")
    assert _login(client, "bob@example.com", RIGHT, "198.51.100.1").status_code == 200


def test_the_per_address_limit_still_applies_from_one_address(behind_vercel, client, make_account):
    make_account("ada@example.com")
    codes = [_login(client, "ada@example.com", WRONG, "192.0.2.7").status_code for _ in range(6)]
    assert codes == [401] * 5 + [429]  # 5 a minute from one address, as before


def test_a_forged_address_header_is_ignored_off_vercel(not_behind_a_proxy, client, make_account):
    make_account("ada@example.com")
    codes = [_login(client, "ada@example.com", WRONG, f"203.0.113.{i}").status_code for i in range(1, 7)]
    # Off Vercel the header is not ours, so every attempt counts against the real socket address.
    assert codes == [401] * 5 + [429]


def test_the_trusted_address_is_used_and_validated(behind_vercel, not_behind_a_proxy, client):
    # not_behind_a_proxy runs second and removes VERCEL: configure the header explicitly instead.
    from fastapi import Request

    get_settings().client_ip_header = "x-vercel-forwarded-for"
    try:

        def req(value):
            headers = [(b"x-vercel-forwarded-for", value.encode())] if value is not None else []
            return Request({"type": "http", "headers": headers, "client": ("10.0.0.9", 1234)})

        assert client_ip(req("203.0.113.5")) == "203.0.113.5"
        assert client_ip(req("203.0.113.5, 10.1.1.1")) == "203.0.113.5"  # first entry only
        assert client_ip(req("2001:db8::1")) == "2001:db8::1"
        assert client_ip(req("not-an-address")) == "10.0.0.9"  # malformed: socket address
        assert client_ip(req(None)) == "10.0.0.9"
    finally:
        get_settings().client_ip_header = None


def test_the_audit_log_records_the_trusted_address(behind_vercel, client, owner_engine):
    r = client.post(
        "/v1/auth/signup",
        json={
            "email": "ada@example.com",
            "password": "correct horse battery staple",
            "full_name": "Ada",
            "organization_name": "Studio",
        },
        headers={"x-vercel-forwarded-for": "203.0.113.42"},
    )
    assert r.status_code == 201
    with owner_engine.connect() as c:
        ips = set(c.execute(text("SELECT ip FROM audit_logs")).scalars())
    assert ips == {"203.0.113.42"}


def test_limits_store_no_email_or_address(behind_vercel, client, make_account, owner_engine):
    make_account("ada@example.com")
    _login(client, "ada@example.com", WRONG, "203.0.113.8")
    with owner_engine.connect() as c:
        buckets = list(c.execute(text("SELECT bucket FROM rate_limit_hits")).scalars())
    assert len(buckets) == 2  # one per-address bucket and one per-email bucket
    assert all(len(b) == 64 and "ada" not in b and "203" not in b for b in buckets)
