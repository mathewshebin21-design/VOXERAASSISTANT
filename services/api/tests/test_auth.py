from datetime import UTC, datetime, timedelta

import jwt

from app.config import get_settings


def test_signup_creates_user_workspace_and_owner_role(make_account):
    a = make_account("ada@example.com", "Halden & Rye")
    orgs = a.get("/v1/me/organizations").json()
    assert len(orgs) == 1 and orgs[0]["role"] == "owner" and orgs[0]["organization"]["name"] == "Halden & Rye"
    assert a.get(a.o("/business-profile")).json()["display_name"] == "Halden & Rye"
    assert a.get(a.o("/settings")).json()["timezone"] == "Europe/London"


def test_duplicate_email_is_rejected_case_insensitively(client, make_account):
    make_account("ada@example.com")
    r = client.post(
        "/v1/auth/signup",
        json={
            "email": "ADA@Example.com",
            "password": "another good passphrase",
            "full_name": "X",
            "organization_name": "Y",
        },
    )
    assert r.status_code == 409


def test_weak_password_rejected(client):
    r = client.post(
        "/v1/auth/signup",
        json={"email": "a@example.com", "password": "short", "full_name": "A", "organization_name": "B"},
    )
    assert r.status_code == 422
    r = client.post(
        "/v1/auth/signup",
        json={"email": "a@example.com", "password": "aaaaaaaaaaaaaaaa", "full_name": "A", "organization_name": "B"},
    )
    assert r.status_code == 422


def test_unknown_fields_rejected(client):
    r = client.post(
        "/v1/auth/signup",
        json={
            "email": "a@example.com",
            "password": "correct horse battery",
            "full_name": "A",
            "organization_name": "B",
            "role": "owner",
        },
    )
    assert r.status_code == 422


def test_login_failure_does_not_reveal_whether_email_exists(client, make_account):
    make_account("ada@example.com")
    wrong_pw = client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "nope nope nope"})
    no_user = client.post("/v1/auth/login", json={"email": "ghost@example.com", "password": "nope nope nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()


def test_login_is_rate_limited(client, make_account):
    make_account("ada@example.com")
    codes = [
        client.post("/v1/auth/login", json={"email": "ada@example.com", "password": "wrong password"}).status_code
        for _ in range(6)
    ]
    assert codes[:5] == [401] * 5 and codes[5] == 429


def test_refresh_rotates_and_reuse_revokes_session(client, make_account):
    a = make_account("ada@example.com")
    first = a.tokens["refresh_token"]
    r = client.post("/v1/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    second = r.json()
    assert second["refresh_token"] != first
    # Replaying the old token is treated as theft: the session dies, including fresh tokens.
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 401
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {second['access_token']}"}).status_code == 401
    assert client.post("/v1/auth/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401


def test_logout_invalidates_access_token_immediately(client, make_account):
    a = make_account("ada@example.com")
    assert a.get("/v1/me").status_code == 200
    assert a.post("/v1/auth/logout").status_code == 204
    assert a.get("/v1/me").status_code == 401


def test_logout_all_ends_every_session(client, make_account):
    a = make_account("ada@example.com")
    other = client.post("/v1/auth/login", json={"email": a.email, "password": a.password}).json()
    assert a.post("/v1/auth/logout-all").status_code == 204
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {other['access_token']}"}).status_code == 401


def test_tampered_expired_and_missing_tokens_rejected(client, make_account):
    a = make_account("ada@example.com")
    assert client.get("/v1/me").status_code == 401
    assert (
        client.get("/v1/me", headers={"Authorization": "Bearer " + a.tokens["access_token"][:-3] + "abc"}).status_code
        == 401
    )
    claims = jwt.decode(a.tokens["access_token"], options={"verify_signature": False})
    s = get_settings()
    claims["exp"] = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())
    expired = jwt.encode(claims, s.jwt_secret.get_secret_value(), algorithm="HS256")
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    forged = jwt.encode(
        {**claims, "exp": claims["exp"] + 3600}, "not-the-real-secret-not-the-real-secret", algorithm="HS256"
    )
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_passwords_are_stored_hashed(make_account, owner_engine):
    from sqlalchemy import text

    make_account("ada@example.com")
    with owner_engine.connect() as c:
        h = c.execute(text("SELECT password_hash FROM users")).scalar_one()
    assert h.startswith("$argon2id$") and "correct horse" not in h
