# Phase 2: migration rehearsal for 0010 and 0011

- **Status:** rehearsed locally on a throwaway clone. Hosted rehearsal prepared but **not run**.
- **Production:** unchanged. No migration, merge or deployment is authorised by this document.

## 1. Why preview deployments are red (expected)

| Branch | Commit | API preview | Web preview |
|---|---|---|---|
| `claude/phase2-rate-limiter` (PR #27) | `3be8d65` | `dpl_AKPzJKvtJvkJjzu63NEL5bzSuYBT`: **ERROR** | `dpl_6Ean8PVFjQxRk2BqNoDHDKvxfgvQ`: READY |
| `claude/phase2-call-records` (PR #28) | `d7b4022` | `dpl_4YjGdE1hzffrovTv19oehxvdii29`: **ERROR** | `dpl_BxGnMV4uKCZtXL9HhgyurGTtqc4a`: READY |

The build logs show:
- **PR #27:** `vercel_build: REFUSING TO DEPLOY: database schema is at 0009, this code needs 0010.`
- **PR #28:** `… this code needs 0011.`

**This is the schema gate, not a configuration fault.** `vercel_build.py` makes three checks in order. It stops at the first that fails, and only the third failed:
1. Database credentials must be present, or it prints "missing database configuration".
2. It connects read-only and checks the database's environment claim (`deploy_env.mismatch`). It is a refusal with "Nothing was changed" if the claim does not match.
3. It compares the schema revision with the code's migration head.

So both builds connected, the database confirmed it is claimed for **staging**, and only the revision differed.

**Which database previews use.** These branches have no branch-specific database variables, so they use the project's generic Preview variables:
- `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, targets *development* and *preview*;
- a variable set separate from the *production* targets (only names and scopes were read, never values);
- a database claimed for `staging` by the environment marker (migration 0007). A production database carries the `production` claim, so a preview can never pass against it.

## 2. Migration review (0010, 0011)

| Area | Finding |
|---|---|
| Dependencies | Linear chain 0009 → 0010 → 0011. Each change only creates objects; no existing table, column or constraint changes |
| Data integrity | 0011 lifecycle, time, channel, status, outcome and no-audio rules are database check constraints. Event sequence numbers are unique per call |
| **Review fix** | An event's tenant now has to match its call's, through a composite foreign key `(call_id, organization_id)` → `calls(id, organization_id)`. Before, only the app and RLS ensured this. Tested |
| **Review fix** | Retention purge no longer depends on a settings row existing (`LEFT JOIN`, 90-day default). Before, calls in a workspace without settings would never be purged |
| Tenant isolation | Standard RLS on `calls` and `call_events`. `rate_limit_hits` has no tenant data and no runtime access, only a validated SECURITY DEFINER function |
| Privileges | Runtime role: no access to `rate_limit_hits`; no UPDATE or DELETE on `call_events`. Both definer functions use `SET search_path` and `REVOKE ALL … FROM PUBLIC` |
| Locks | `CREATE` only, with no lock on existing tables |
| Rollback | `downgrade 0009` drops the new objects. It loses only rate-limit counters and call records (none exist before release) |
| Old code on the new schema | Production code `0b04695` on a 0011 database: `/readyz` 200, login 200, sign-up 201, no errors. So "migrate first, then merge" leaves no broken window |

## 3. Local rehearsal (done)

**Setup.** A throwaway PostgreSQL 16 cluster on port 5433, with a Neon-style owner role and the runtime role managed by `migrate.py`:
1. Production code `0b04695` migrated it to 0009 and claimed it for `production`.
2. Its own API seeded 3 workspaces.
3. This branch's runner and verifier then ran the exact steps of `.github/workflows/phase2-clone-rehearsal.yml`.

| Step | Result |
|---|---|
| 1. Baseline at 0009 (read-only) | Passed; row counts saved |
| 2. `migrate.py --check` | "schema at 0009; code head 0011". Nothing changed |
| 3. Migrate 0009 → 0011 | "done: schema at 0011, claimed for production". The runtime role's password was unchanged |
| 4. Verify 0011 against the baseline | All PASS, including new checks: 0010 table and definer function, runtime role may call it and has no table privileges; 0011 tables, `ck_call_no_audio`, events append-only |
| 5. Downgrade to 0009 | 0011 → 0010 → 0009 |
| 6. Verify 0009 against the baseline | All PASS; row counts identical |
| 7. Re-upgrade and verify 0011 | All PASS |
| 8. Nothing pending | "schema at 0011; code head 0011" |

**Totals:** 350 PASS, **0 FAIL**. Row counts were identical at every stage: organizations 3, users 3, audit logs 3, and so on.

**Smoke test of the new code on the clone** (the production smoke test from the migration proposals):
- five wrong passwords, then the sixth refused with **429**, `Retry-After: 106`;
- a call started (201), event 1 added (201), ended with a summary (200), read back (200), erased (204), then gone (404);
- two rate-limit rows, each a 64-character digest.

## 4. Hosted rehearsal (prepared, not run)

`.github/workflows/phase2-clone-rehearsal.yml` runs the same steps against a **disposable Neon clone of production**. It follows the PR #20 rehearsal pattern:
- only the clone's credentials, from a GitHub environment `phase2-rehearsal`;
- every part of the connection string masked;
- row counts only in the evidence artifact.

It runs only when `.github/rehearsal/phase2-clone.request` is pushed to `claude/phase2-call-records`. It never reads production, staging or RC-1 secrets.

**Owner steps to run it (needs approval):**
1. In Neon, create a branch of **production**, named for example `phase2-rehearsal-<date>`. It is a copy-on-write clone; production is not modified.
2. In GitHub, create the environment `phase2-rehearsal`. Add the clone's owner connection strings as `PHASE2_REHEARSAL_DATABASE_URL_UNPOOLED` and `PHASE2_REHEARSAL_DATABASE_URL`.
3. Tell me, and I will push the request file and report the run.
4. Delete the Neon branch and the environment afterwards.

**Staging previews.** The PR previews stay red until the shared staging database is at 0011. Migrating staging is a separate decision: it changes the database every preview branch uses. Alternatively, a dedicated Neon branch with branch-scoped variables can serve one PR's previews, as for PR #23.
