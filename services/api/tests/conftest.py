"""Test fixtures. Tests run against a real PostgreSQL database (voxera_test) with the
real migrations applied, so row-level security and grants are exercised exactly as in production."""

import os

os.environ.setdefault("VOXERA_ENV", "test")
os.environ.setdefault("VOXERA_DATABASE_URL", "postgresql+psycopg://voxera_app:app-dev-only@localhost:5432/voxera_test")
os.environ.setdefault(
    "VOXERA_MIGRATION_DATABASE_URL", "postgresql+psycopg://voxera_owner:owner-dev-only@localhost:5432/voxera_test"
)
os.environ.setdefault("VOXERA_JWT_SECRET", "test-secret-test-secret-test-secret-123")

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import app
from app.routers.auth import login_limiter

OWNER_URL = os.environ["VOXERA_MIGRATION_DATABASE_URL"]
APP_URL = os.environ["VOXERA_DATABASE_URL"]
TABLES = ["users", "organizations", "deletion_receipts"]  # everything else cascades


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", OWNER_URL)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(scope="session")
def owner_engine():
    e = create_engine(OWNER_URL)
    yield e
    e.dispose()


@pytest.fixture(scope="session")
def app_engine():
    e = create_engine(APP_URL)
    yield e
    e.dispose()


@pytest.fixture(autouse=True)
def clean(owner_engine):
    with owner_engine.begin() as c:
        c.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
    login_limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class Account:
    def __init__(self, client: TestClient, email: str, org_name: str, password: str = "correct horse battery staple"):
        self.client, self.email, self.password = client, email, password
        r = client.post(
            "/v1/auth/signup",
            json={
                "email": email,
                "password": password,
                "full_name": email.split("@")[0].title(),
                "organization_name": org_name,
            },
        )
        assert r.status_code == 201, r.text
        self.tokens = r.json()
        orgs = self.get("/v1/me/organizations").json()
        self.org_id = orgs[0]["organization"]["id"]
        self.user_id = self.get("/v1/me").json()["id"]

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.tokens['access_token']}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def delete(self, url, json=None):
        return self.client.request("DELETE", url, headers=self.headers, json=json)

    def o(self, path: str = "") -> str:
        return f"/v1/orgs/{self.org_id}{path}"


@pytest.fixture
def make_account(client):
    def _make(email: str, org_name: str = "Studio") -> Account:
        return Account(client, email, org_name)

    return _make


def join(owner: Account, member: Account, role: str) -> None:
    """Invite ``member`` into ``owner``'s workspace with ``role`` and accept."""
    r = owner.post(owner.o("/invitations"), json={"email": member.email, "role": role})
    assert r.status_code == 201, r.text
    r = member.post("/v1/invitations/accept", json={"token": r.json()["token"]})
    assert r.status_code == 200, r.text
