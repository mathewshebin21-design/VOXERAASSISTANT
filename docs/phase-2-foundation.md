# Phase 2 — Multi-tenant SaaS foundation

_Status: implemented and tested locally against PostgreSQL 16, and connected to the Flow front end. Not deployed._

Code: [`services/api`](../services/api) · Decisions: [ADR-0002](decisions/ADR-0002-tenancy-and-auth.md)

## Scope delivered

| Requirement | Implementation |
|---|---|
| Secure authentication | Sign-up, login, refresh, logout, logout-all. argon2id, 15-min JWT bound to a revocable session, rotating single-use refresh tokens with reuse detection, login rate limiting, generic error messages |
| Business organisations | `organizations`; a user can belong to several; `POST /v1/orgs` creates more |
| Multi-tenant isolation | App-level scoping + Postgres RLS under a non-owner role (see ADR-0002) |
| Team roles | owner / admin / manager / viewer, matching the design's permission matrix; last-owner protection; only owners grant/revoke owner |
| Invitations | Hashed, single-use, expiring, email-bound tokens; revoke; list (tokens never listed) |
| Agent ownership | `agents` belong to one workspace, record `created_by`; greeting must disclose AI (validated) |
| Business profile | `GET/PUT /business-profile` (validated phone, https website, UK defaults) |
| Office hours | `GET/PUT /office-hours` — atomic weekly replace, multiple intervals per day, overlap and order checks |
| Service catalogue | CRUD with durations, buffers, prices in pence, patch-test flag, agent-bookable flag, case-insensitive unique names |
| Workspace settings | Time zone (IANA-validated), locale, recording notice on/off + text, retention 7–365 days, data region |
| Audit logs | Every mutation recorded with actor, target, details, IP and user agent; append-only at the database level; `GET /audit-logs` |
| Subscription-ready usage tracking | `POST /usage-events` (idempotent by key; conflicting replays rejected) and `GET /usage/summary?month=` separating **live** from **simulated** usage |
| Account deletion and export | `GET /me/export`, `DELETE /me` (password-confirmed; solo workspaces deleted; last owner of shared workspace must transfer first); `GET /orgs/{id}/export` (owner only, audited, no secrets); `DELETE /orgs/{id}` (owner, name confirmation, cascades all tenant data, leaves a non-personal deletion receipt) |
| Ops basics | `/healthz`, `/readyz`, JSON logs with request IDs, security headers, Dockerfile, docker-compose, Alembic migrations (round-trip tested), CI workflow |

## Verification

`cd services/api && uv run pytest` — **57 tests, all passing** against a real PostgreSQL 16 with the real migrations:

- **Auth (11):** signup provisioning, duplicate email (case-insensitive), weak/unknown-field rejection, indistinguishable login failures, rate limit, refresh rotation + reuse revocation, logout, logout-all, tampered/expired/forged tokens, argon2id storage.
- **Tenant isolation (19):** 11 read endpoints return 404 across tenants; cross-tenant writes by ID fail; unknown vs foreign org indistinguishable; RLS verified directly in SQL (filtering, zero rows without context, blocked cross-tenant INSERT, zero-row cross-tenant UPDATE); API role owns no tables.
- **Roles (10):** viewer/manager/admin boundaries, owner-only owner changes, last-owner protection, transfer, leave, invitation rules (wrong email, single use, revoked, tokens never listed).
- **Business (5), records (5), privacy (5), health (2).**
- Ruff lint + format clean. Migrations upgrade → downgrade → upgrade clean.

Not verified here: the Docker image build (no Docker daemon in this environment — CI builds it), load, and penetration testing.

## Front-end integration (Flow)

The approved Flow design now uses the API for everything Phase 2 covers ([ADR-0003](decisions/ADR-0003-web-session-bff.md)):

| Flow screen | Backed by |
|---|---|
| `/flow/enter` — sign in / create workspace | `/api/session/*` → auth endpoints; httpOnly cookies |
| Workspace switcher, new workspace, sign out (header) | `/me/organizations`, `POST /orgs`, logout |
| `/flow/app/workspace` — Profile, Opening hours, Services, Settings, Data & privacy | business profile, office hours, services, settings, export, workspace and account deletion |
| `/flow/app/team` — members, roles, invitations, audit log | members, invitations, audit logs (permission-aware UI) |
| `/flow/invite?token=…` | invitation acceptance |
| `/flow/app/agent` — saved agents; `/flow/app/new` wizard saves to workspace | agents |
| `/flow/app/usage` — metered usage; simulator sessions recorded as simulated minutes | usage summary and usage events |

Signed out, every page still works in demo mode. Signed in, pages that have no real data yet (calls, live, insights, calendar, knowledge, simulator, canvas) show a "still shows demo data" notice.

**Verification:** `scripts/e2e-live.mjs` — **21/21 checks** driving a real browser against Next.js + API + PostgreSQL: sign-up, httpOnly cookies, CSRF rejection, profile save + persistence, API validation errors surfaced, opening hours (valid + rejected), services (add + duplicate rejected), settings, agent save, invitation link, audit log entries, simulated usage separated from billable, demo notice, export without secrets, colleague accepts invitation as manager, read-only UI for manager, single-use invitation, outsider gets 404 through the proxy, sign out/in, workspace deletion revokes colleague access, account deletion. The 114-check demo-mode suite still passes.

## Known limitations / next steps
- Invitation and password-reset **emails** are not sent yet (Phase 8 messaging); in development the invite token is returned by the API.
- No MFA/SSO yet. Login limiter is single-instance.
- Calls, transcripts, knowledge and appointments tables arrive with Phases 3–7, each with RLS policies and tests in the same pattern.
