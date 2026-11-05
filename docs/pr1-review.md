# PR #1 code review: `claude/stoic-davinci-vvk3jg` at `a7ba2f0`

Reviewed 2026-11-03, read-only. Target `claude/confident-shannon-7nb05f` at `767c0f2` (production).
Scope: 58 files, +5061 / −335. The review covers security, migration safety, tenancy, compatibility and the deployment guards.
Evidence: GitHub CI 7/7 green at `a7ba2f0`; release-path rehearsal on disposable databases 51/51; compatibility harness 40/40; merge simulation clean.

**Verdict: approve for release, with M1 fixed in the release plan (docs) and M2 covered by an owner setting before the first production migration.** No high-severity findings.

## Findings
| # | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| M1 | Medium | Release procedure | `docs/production-release-plan.md` says to run step 6 (upgrade to 0008) from the production branch. Before PR #2 merges, the production branch's migration head is 0007, so that run does nothing. Running it from `claude/agent-studio` instead would work, but only if the `production` environment allows feature branches, which it shouldn't (M2). | **Reorder RC-2:** merge PR #2 first. Its production build refuses (schema 0007, code needs 0008) and PR #1 stays live. Then run `db-migrate` upgrade from the production branch, whose head is now 0008, and redeploy. Every production migration then runs only from reviewed, merged code. PR #1's code was verified working on 0008. *Fixed in the plan (docs only).* |
| M2 | Medium | `db-migrate.yml` | The workflow doesn't check which branch it runs from. Once it's on the default branch, "Run workflow" lets anyone with write access pick any branch that contains the file, and apply that branch's unreviewed migrations to production. | **Owner setting (required):** in the GitHub `production` environment, set *Deployment branches* to the default branch only, and add a required reviewer. Optional code hardening (later, separate approval): fail the job when `inputs.environment == 'production'` and `github.ref_name` isn't the default branch. |
| L1 | Low | Supply chain | Actions are pinned by tag (`actions/checkout@v4`, `astral-sh/setup-uv@v6`) in a job that holds the production owner connection string. | Pin to full commit SHAs in a follow-up. |
| L2 | Low | Runtime guard | The guard middleware wraps CORS, so its 503 responses carry no CORS headers. A browser reports a network error instead of the reason. The guard still fails closed; only the message is lost. | Register the guard inside CORS, or add the headers. Cosmetic. |
| L3 | Low | Runtime guard | If the environment check itself fails (database briefly unreachable), that instance caches the 503 for 30 s, even after the database recovers. | Acceptable; fails closed. Optionally shorten the window for errors only. |
| L4 | Low | Staging workflow | PR #1's `wait-for-deploy` accepts a short commit prefix and an HTTP 200 placeholder page. PR #2 (`1d40bf6`) fixes this. | None for production; the fix arrives with PR #2. |
| L5 | Low | Credentials | The JWT signing secret and the app-role password are both derived from the database owner password (`app/platform.py`). Rotating the password changes the JWT secret. | Set an independent `VOXERA_JWT_SECRET`; see the runbook's JWT section. |
| L6 | Low, pre-existing | UI honesty | The demo Integrations pages (Command, Flow) say secrets are kept in a "server-side vault, per tenant". No such vault exists yet. | Mark it as planned when those pages are next touched. |

## What was checked and found sound
**Deployment guards**
- `vercel_build.py` connects with `default_transaction_read_only=on`, so it can't write, and it never migrates.
- The build refuses: a missing database on a hosted build, the wrong environment marker, an unclaimed database, an unknown `VERCEL_ENV`, or any schema that isn't exactly the code's head.
- Connection errors end in a non-zero exit, and Vercel then keeps the current deployment.
- `deploy_env.expected()` raises on an unknown `VERCEL_ENV` or a conflicting `VOXERA_EXPECT_DB_ENV`. That runs while the app starts, so a misconfigured hosted app fails closed.
- The runtime guard returns 503 for every path except `/healthz` until the marker matches. Once it matches, the result is cached for the process. The app role can't change the marker.
- `/staging-identity` returns 404 unless the deployment is a preview of the `staging` branch, and 503 unless the database is claimed `staging`.

**Migration safety**
- `migrate.py` holds `pg_try_advisory_xact_lock` and one transaction across role setup, Alembic and the claim, so the claim and the upgrade succeed or fail together.
- A database claimed for another environment stops every action, `--check` included, before anything is touched.
- An unclaimed database needs `--claim --confirm-host <host>` typed back exactly. `--claim-if-empty` applies only to a database with no tables, which production never is.
- A downgrade needs `--yes`. `--check` never writes.
- Workflow inputs reach the script through environment variables, not interpolated into the shell, so there's no injection.
- `ensure_runtime_role` inlines only a 64-character hex password and a validated database name into DDL.
- **0006 is byte-identical to the version production already received** (no change since `0588709`/`469283d`). Production's "0006" is the 0006 in this PR.
- 0007 is additive: one single-row table with CHECK constraints, and `GRANT SELECT` only to the app role. No default privileges grant the app role anything more (checked across 0001–0007).

**Tenancy**
- The new `live_reservations` table has row-level security (`organization_id = app_org()`, with a WITH CHECK clause). The app role may SELECT, INSERT and DELETE, but not UPDATE.
- Cross-tenant cap totals go only through `SECURITY DEFINER` aggregate functions, with `REVOKE ALL FROM PUBLIC` and a fixed `search_path`.
- The marker table holds no tenant data.

**The live AI path**
- Every live endpoint has a permission dependency: `read` for status, `agent_write` for the brain and text-to-speech, `business_write` for the setup assistant.
- The worst-case usage is reserved atomically under a per-kind advisory lock before any provider call. A reused request id is refused with 409. Reservations settle in `finally`. An unsettled reservation keeps counting at its worst case, so the cap is under-used, never exceeded.
- Tool calls are checked against their schemas (`toolcheck.py`). Errors become generic stream events; there's no traceback or key in a response.
- No API key reaches the frontend: no `NEXT_PUBLIC_` key variables, and keys are read only by the server.

**Compatibility**
- On a disposable database copy:
  - `767c0f2` runs on 0006, 0007 (with the marker) and 0008;
  - `a7ba2f0` builds only on 0007 claimed `production`, and runs on 0008;
  - existing users, workspaces and services survive the claim and every upgrade and downgrade.
- `767c0f2` can't be rebuilt ("Can't locate revision 0006"), so rolling back to it is Instant Rollback only.

## Not covered by this review
- The frontend setup-assistant parsing changes (about 1,700 lines, `apps/previews/src/lib/setup/*`). They're covered by unit tests and browser tests, and reviewed for safety only: they write through the same permission-checked API.
- Real provider behaviour (Claude, Gemini, Groq, OpenRouter, Ollama). Only tested against fakes.
