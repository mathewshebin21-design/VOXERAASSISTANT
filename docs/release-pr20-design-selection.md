# Release procedure: PR #20 (design selection) — production schema 0007 → 0009

**Status update, 2026-11-08: released.** PR #20 merged as `dd29ca1` and deployed to production
(API `dpl_EF3sA2hLu3t4XenobFqUWQDsDb9f`, web `dpl_JD731LPMjNcYqhM6egAYsj28LsZU`). The production
database was already at 0009 when it merged. The follow-up release is recorded in
`docs/release-pr21.md`. The original status below is kept as written.

Status (as written before release): **rehearsed, not authorised.** Nothing in this document has been run against production.

## What changes

| Revision | Purpose | On upgrade | On downgrade |
|---|---|---|---|
| `0008_agent_flows` | Agent Studio tables: `agent_flows`, `agent_flow_versions`, `flow_sessions`, `flow_tests`, each with row-level security and a tenant policy; runtime-role grants (published versions are insert-only) | additive; four empty tables | **drops the four tables and their data** |
| `0009_ui_design` | `workspace_settings.ui_design` (NOT NULL, default `atelier`) and `memberships.ui_design` (NULL = follow the workspace), each with a check constraint | additive; existing workspaces become `atelier` | drops the columns (saved design choices are lost) |

Production code `5ee7f57` runs unchanged on a 0009 database, which the rehearsal below proves. So the
**application rollback never needs a schema downgrade.** A schema downgrade is not part of the
rollback plan. If the schema itself must be undone, restore from the recovery branch (step 1).

## Rehearsal evidence (2026-11-07, PR head `345ea3b`)

The rehearsal ran on a separate Postgres instance set up the way Neon is: an owner role, a database
named `neondb`, and the runtime role created by the runner. It used the exact PR #20 files and the
real runner, `scripts/migrate.py`.

| Step | Result |
|---|---|
| Production code (`5ee7f57`) builds the database to 0007 and claims it `production` | done |
| Production-shaped data through production's API: 1 workspace, 1 membership, 1 agent, settings, a service | done |
| Baseline `verify_release.py --expect 0007 --save` | **37/37** |
| `migrate.py --env production --check` | pending: 0008, 0009; runtime role unchanged |
| `migrate.py --env production`, with the production API serving throughout | 0007 → 0008 → 0009 in **0.75 s** |
| `verify_release.py --expect 0009 --baseline` | **82/82**: RLS and policies on every tenant table including the four new ones; runtime role restricted and sees no rows without a tenant; published versions insert-only; design columns and constraints present; every workspace `atelier`; every baseline row count unchanged |
| Production code, process started **before** the migration, against 0009 | **7/7**: sign-in, agent, settings read/write, services, new sign-up, account deletion |
| PR #20 code against 0009 | **10/10**: the above plus default `atelier`, owner sets Command for everyone, owner's own Flow override |
| **Rollback:** production code, fresh process, **after** design choices were saved | **7/7** |
| Schema downgrade 0009 → 0007 on a copy holding one Agent Studio flow | runs, but drops `agent_flows` (the flow is lost) and the saved design choices; customer tables (organizations, users, memberships, agents, services, settings) intact. Confirms: never downgrade production |

The rehearsal does not cover Neon-specific behaviour: the pooler, branch restore and real network latency. Step 2 covers those with a Neon clone of production.

## Procedure

Run each step only after the previous one passes. Steps 3, 5 and 6 change production and each needs explicit authorisation.

1. **Fresh recovery branch.** In Neon, create a branch from production at the current point in time, for example `pre-pr20-<date>`. Record its name and timestamp. This is the only schema-and-data rollback.
2. **Neon clone rehearsal.** Create a second branch from production, `pr20-rehearsal-<date>`, which is disposable. With its connection strings as `DATABASE_URL_UNPOOLED` and `DATABASE_URL`, from `services/api` at the PR head:
   ```
   python scripts/verify_release.py --env production --expect 0007 --save baseline.json
   python scripts/migrate.py --env production --check
   python scripts/migrate.py --env production
   python scripts/verify_release.py --env production --expect 0009 --baseline baseline.json
   ```
   All checks must pass. The clone carries production's `production` marker, which is why `--env production` is correct. Point it only at the clone's strings. Delete the clone afterwards.
3. **Migrate production** with the `db-migrate` workflow on the production environment, which needs approval: first `check`, then `upgrade`. Then run `verify_release.py --expect 0009 --baseline` with a baseline taken immediately before. Live traffic may add rows, but no table may lose rows.
   - Between steps 3 and 5, production runs old code on the new schema. The rehearsal shows this is safe, so a delay between the two steps is harmless.
4. **Mark PR #20 ready for review**, confirm CI is green on the final head, and confirm the base has not moved. If it has, update the branch and let CI rerun.
5. **Merge PR #20.** Both apps deploy to production.
   - Confirm the voxera-api build log shows `database preflight passed (production, schema at 0009)` and the deployment is READY.
   - Confirm the voxera-flow deployment is READY.
6. **Production smoke test:**
   - `/healthz` returns 200 with the merge commit, and `/readyz` returns 200.
   - Sign in at `/start`: the existing workspace opens in Atelier.
   - On a throwaway account: choose a design, reload, switch from each shell's account menu, then delete the account.
   - Existing per-design sign-in pages still work.
7. **Clean-up:**
   - Delete the PR #20 Preview variables on `claude/design-selection`.
   - Delete the two variables parked on voxera-api's Development target: `VOXERA_DATABASE_URL` and `VOXERA_BUILD_DATABASE_URL`.
   - Delete the isolated Neon branch `pr20-design-selection-isolated`.
   - Keep the recovery branch until the release has been stable for an agreed period.

## Rollback

| Situation | Action | Data impact |
|---|---|---|
| Problem in the new UI or API after step 5 | Instant Rollback both projects to the previous production deployments | none; the schema stays at 0009, and old code is compatible with it |
| Problem found after step 3, before step 5 | Do nothing to the schema; fix forward, or stay on old code | none |
| Schema must be undone (should not happen) | Restore from the step 1 recovery branch (Neon restore), then roll back the code | anything written after the branch point is lost; decide case by case |
| `migrate.py --downgrade-to` | **Not used in production.** It drops Agent Studio data and design choices | destructive |

## Tooling

- `services/api/scripts/verify_release.py` is read-only: every connection runs with `default_transaction_read_only=on`. It prints no hosts, names or secrets. Its unit tests are in `services/api/tests/test_verify_release.py`.
- `services/api/scripts/migrate.py` provides the existing guards: an environment claim, an advisory lock, `--check`, and `--yes` for downgrades.
