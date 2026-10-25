# VOXERA API (`services/api`)

FastAPI + PostgreSQL multi-tenant backend. Phase 2 scope: see [`docs/phase-2-foundation.md`](../../docs/phase-2-foundation.md).

## Run locally

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), PostgreSQL 16.

```bash
# 1. Database roles (once). Or: docker compose up db (uses deploy/init-roles.sql)
psql -U postgres -f deploy/init-roles.sql

# 2. Install and migrate (migrations run as the schema owner)
uv sync
uv run alembic upgrade head

# 3. Start the API (runs as the non-owner role so row-level security applies)
cp .env.example .env   # then set real values
uv run uvicorn app.main:app --reload
# → http://localhost:8000/docs
```

Or the whole stack: `docker compose up` from the repository root (db → migrate → api, plus the Flow front end on :3000).

## Test

```bash
uv run pytest            # needs the voxera_test database from deploy/init-roles.sql
uv run ruff check app tests migrations && uv run ruff format --check app tests migrations
```

## Layout

```
app/
  config.py        settings from environment (VOXERA_*); refuses dev secrets in production
  db.py            engine + per-transaction RLS context (app.org_id / app.user_id)
  models.py        SQLAlchemy models
  security.py      argon2id, JWT access tokens, opaque token digests
  permissions.py   role → permission matrix
  deps.py          auth, OrgContext, require(perm)
  routers/         auth, orgs (members, invitations, export, deletion), business, agents, records (audit, usage)
migrations/        Alembic: 0001 schema, 0002 RLS policies, grants, append-only audit
tests/             pytest suite against real Postgres
```
