# Phase 1 production acceptance (customer workflows)

Status: **passed in production on 2026-11-08.** This is the permanent record. The GitHub
evidence artifact expires on 2027-02-06.

## Why this run was needed

The RC-1 release review (`docs/rc1-release-review.md`) requires synthetic-account acceptance of
customer workflows **in production** before Phase 1 is complete. The same suite had passed only on
the isolated RC-1 Preview (`rc1-hosted` run 42297447382). The earlier production smoke test for
PR #21 covered sign-in, the probe's own workspace and design selection only.

## Authorisation

Owner approval, recorded in `.github/rehearsal/phase1-prod-acceptance.request` on the branch
`claude/phase1-prod-acceptance` (commit `dee16bc`):

> Run the Phase 1 production acceptance on synthetic accounts against 667eec1, using workflow
> b03260c. Retain the evidence artifact and deletion receipts. Do not run migrations, change
> production configuration, or delete infrastructure.

## Identifiers

| Item | Value |
|---|---|
| Production commit under test | `667eec1f649a394f2f1b1ddef2aaf815ab3129b0` (PR #22 merge) |
| Production API deployment | `dpl_37biEKucTw5UoV32bb5RkuALp1QK`; its build log: `database preflight passed (production, schema at 0009)` |
| Workflow | `.github/workflows/phase1-prod-acceptance.yml` at `b03260c`, triggered by `dee16bc` |
| Run | [42464039694](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/42464039694), job 128679320105, 2026-11-08 08:42:10–08:43:00 UTC |
| Evidence artifact | `phase1-prod-acceptance-dee16bc66d15e4b6a4cde04114751ccbd45c2b5a`, ID 13611066471, zip SHA-256 `e8ad9008e00d8e27e808fbf2eae1f42e07bac53833767de5dc02a7ba18b05552` |
| Suite | `apps/previews/scripts/prod-acceptance.mjs`, which reuses `rc1-acceptance.mjs` |

## Safety controls

- **Read-only gate first.** Nothing was written unless production was serving exactly `667eec1`,
  was ready, and was in production mode (HSTS on, `/docs` 404, the staging and RC-1 identity
  endpoints 404). The gate passed before the writes and again after them.
- **Production database identity** comes from the deployment's build preflight above. The workflow
  used no database credentials.
- **Synthetic accounts only** (`@prod-acceptance.example`), with a random per-run password that was
  never printed or saved.
- **No paid provider:** the suite calls only staff REST endpoints.
- **Clean-up reported separately** from test results, with proof.

## Results: 108 passed, 0 test failures, 0 clean-up failures, 5 notes

| Area | Checks | Result |
|---|---|---|
| Authentication and sessions | 13 | Pass: sign-up, duplicate and weak password refused, uniform failure message, refresh rotation, reuse revokes the session, logout |
| Rate limiting | 1 | Pass: 429 within 8 failed sign-ins |
| Tokens (JWT) | 9 | Pass: missing, garbage, tampered, swapped-subject, foreign-secret, `alg=none` and expired tokens refused; lifetime ≤ 15 min; issuer and audience present |
| Saved configuration | 3 | Pass: time zone, opening hours, service |
| Scheduling | 10 | Pass: availability, time zone (+05:30), naive vs offset times, opening hours, past, 60-day horizon, quarter hour, phone validation |
| Concurrency | 4 | Pass: 8 parallel bookings of one slot → exactly one; 2 parallel reschedules → one |
| Rescheduling | 4 | Pass |
| Cancellation | 5 | Pass: idempotent, no move after cancel, rebook, history kept |
| Tenant isolation | 20 | Pass |
| Roles (viewer, staff) | 15 | Pass |
| Security | 9 | Pass: headers, CORS, minimal error bodies, no credential strings |
| Reliability | 4 | Pass: commit, readiness, 20 concurrent reads, identity unchanged after the writes |
| Clean-up | 8 | Pass: 4 accounts deleted (with their 4 workspaces); each then refused sign-in (401) |

Notes, all expected:
- `alg=none` was refused with 403 before reaching the API (Vercel's edge); the API returns 401.
- HSTS is present and `/docs` returns 404: production mode is confirmed (finding F1).
- The staff booking API has no idempotency key; duplicates are prevented by slot capacity.
- No daylight-saving change falls inside the 60-day horizon; unit tests cover it.

## Effect on production

- Synthetic data existed from 08:42:18 to 08:42:55 UTC, in two throwaway workspaces.
- About 8 deletion receipts remain, one per deleted account and workspace, as instructed. They
  contain no personal data.
- No migration, configuration change or deployment.

## Local rehearsal before the run

Against a local API and PostgreSQL with the production configuration of the suite: 108 passed,
0 failed. Afterwards the database held no synthetic users, workspaces, services or orphaned rows,
and the evidence file contained no password. A second dry run invalidated every token before
clean-up; the retry path still deleted all four accounts.
