# Phase 0 closure report: environment isolation and release readiness
Prepared 2026-11-02 19:30 UTC. **Recommendation: NOT COMPLETE.** All isolation mechanisms pass. Three gates stay open only because of historical preview deployments that still hold production credentials. Closing them needs owner actions; no code changes are needed.

## Evidence base
| Item | Commit / ID | Result |
|---|---|---|
| PR #2 head | `41a4a13` (pushed), includes `1d40bf6` readiness fix and `41a4a13` tracker | CI **6/6 green**: `test`, `live-e2e` ×2, `check` ×2, Vercel. `check` runs the readiness and isolation tests (30) |
| Staging verification | Actions run 41502348420 at `94dae66` | migrate ✅, readiness ✅, isolation ✅, staging browser tests 14/14, demo designs 131/131 |
| Release plan | `23ec727` + amendments (local, not pushed) | plan only |
| Disposable-database negative tests | local Postgres 16; 18 migrator and build checks, 20 runtime checks, 40 compatibility checks | **78/78 pass**. All test databases and worktrees deleted afterwards |
| Production, read-only | voxera-api `dpl_EEBqGurCwGj7mWkhzWNGQSo4JWiA` and voxera-flow `dpl_9HL5T88ctcVAPYQqHiHf9Dj1DzSm` at `767c0f2` | unchanged since before this work. 0 runtime errors in 24 h |

## Acceptance gates
| Gate | Status | Evidence |
|---|---|---|
| **0.1** Preview cannot read production customer data | **FAIL**: historical exception | **Current configuration: PASS.**<br>• Preview and Development hold only `voxera-staging` (`store_bgUUGFK36oqz4kfJ`).<br>• On a disposable production-marked database, a preview deployment returned 503 for every read (`/v1/me/organizations`, `/readyz`), with reason "this staging deployment is connected to the production database".<br>• Sessions differ by environment (JWT derived per database).<br>**Exception:** 8 historical voxera-api previews (PR #1 commits `b1adb59`…`469283d`) were built with voxera-db's credentials and predate the runtime guard, and previews are publicly reachable. |
| **0.2** Preview cannot write to production | **FAIL**: same exception | **Current configuration: PASS.** Sign-up and sign-in were refused with 503, and no rows were written (counted before and after). The same historical previews can still write, for example through sign-up. |
| **0.3** Staging migrator refuses production | **PASS** | On a database claimed `production`: `--env staging` upgrade, `--claim-if-empty` and downgrade all stop with "belongs to production, not staging. Nothing was changed". An unclaimed, non-empty production-like database (at 0006, with customer data) is never auto-claimed. |
| **0.4** Production migrator refuses staging | **PASS** | On a database claimed `staging`: `--env production` upgrade, `--claim --confirm-host` and downgrade all stop. A wrong `--confirm-host` also stops. |
| **0.5** Production credentials absent from Preview and Development | **FAIL**: deployed artifacts | **Configuration: PASS.** voxera-api has 16 voxera-db variables, **Production only**; 16 voxera-staging variables, **Preview and Development only**; no per-branch overrides; `VOXERA_ENV` is Production only. voxera-flow has no database variables. **Artifacts:** the 8 historical previews' frozen environments very likely contain voxera-db's owner credentials (their build logs show migrations against the then-only database, including "0005 → 0006" on production). |
| **0.6** Wrong deployment or database identity fails closed | **PASS** | **Build:** preview onto production, production onto staging, no database, and unknown `VERCEL_ENV` all refuse (controls pass). In the hosted logs, previews refused with "missing database configuration" before staging existed, and passed "(staging, schema at 0008)" after. **Runtime:** 503 on every route except `/healthz`. `/staging-identity` returns 503 on a non-staging database. |
| **0.7** Hosted browser tests use only staging data | **PASS** | `staging.yml` order: migrate (staging) → readiness → isolation gate (API marker `staging` + commit; web commit + `usesStagingApi`) → tests with `BASE_URL` = staging web. The tests delete their accounts. The readiness fix (`1d40bf6`) now rejects placeholder pages and wrong or short commits (19 tests, green in CI). |
| **0.8** Production unaffected by staging operations | **PASS** | No production deployment since `767c0f2`. voxera-db store and variables unchanged. 0 production runtime errors in 24 h. The staging migration log names host `ep-raspy-brook-…eu-west-2` (staging) only. All production checks in this audit were read-only. |

## Security findings
| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | 8 historical voxera-api previews (`dpl_D8WT…`, `AzTG…`, `9MLF…`, `F7mW…`, `mfq3…`, `BPQT…`, `3mGp…`, `CMEq…`) very likely hold voxera-db owner credentials and lack the runtime guard. Previews are publicly reachable. Anyone could create accounts in, or use, production through outdated code, outside production monitoring. | **High** | Open: owner action (delete, then rotate) |
| S2 | 8 historical voxera-flow previews call the production API. They have no database credentials and production's own authentication applies. | Low | Open: delete with S1 |
| S3 | Preview Deployment Protection appears to be **off**: an unauthenticated CI runner read preview JSON. Settings aren't readable with my access without creating public share links (not used). | Medium | Owner to confirm or enable |
| S4 | The JWT secret is derived from the database password, so rotation signs everyone out. It can be decoupled with `VOXERA_JWT_SECRET`, which explicit settings override. | Low | Optional |
| S5 | The app role has least privilege: no superuser, no RLS bypass, owns nothing, read-only on the environment marker, insert-only on versions. | Positive | Verified |

## Production compatibility (proven on disposable databases with the real commits)
- **Production today:** `767c0f2` (migrations 0001–0005) runs on schema **0006**, which a PR #1 preview applied. It also runs normally on 0007 with the marker, and on 0008: sign-up, row-level-secured reads and writes, sign-out, sign-in all work.
- **`767c0f2` cannot be rebuilt.** Its build fails with "Can't locate revision 0006" and changes nothing. **Only Instant Rollback works for it**, and that rules out rotating credentials before PR #1 is live.
- **PR #1 (`a7ba2f0`) runs on 0008 but refuses to build there** (exact-match safety check). Its production build on 0007 with the marker passes.
- **Adding the marker** is one table, read-only for the app role. `767c0f2` ignores it, and claiming kept customer data intact (row count before = after).
- **`db-migrate` must run from the production branch**, so a claim lands on 0007 and not 0008.
- **Vercel:** a failed or refused build doesn't replace the current deployment, as observed for every refused preview here. Environment changes reach only new deployments.

## Backup and rollback
- **Neon Free plan:** a 6-hour restore window (≤ 1 GB of history) and 1 manual snapshot. Take the snapshot or a branch immediately before the first production migration. The restore window is too short to rely on alone.
- **Rollback order:** application first (Instant Rollback; migrations are additive), then schema (`db-migrate` downgrade: 0008 drops Agent Studio data; going below 0007 drops the marker).
- **Credential rotation:** brief outage (about 1–3 minutes between the role reset and the redeploy). Pre-rotation deployments, including rollback targets, can no longer connect afterwards. The GitHub `production` secret must be updated too.
- Full procedure: `docs/production-release-plan.md`.

## To close Phase 0 (owner actions)
1. **S1/S2:** delete the 8 historical voxera-api and 8 voxera-flow previews. This closes 0.1, 0.2 and 0.5 for deployed artifacts.
2. **S3:** confirm or enable Deployment Protection for Preview on both projects. This doesn't block closure once step 1 is done.
3. **After PR #1 is live:** rotate voxera-db's password (release plan step 8). This covers anything already copied.

After step 1, I can re-verify read-only that no READY preview predates the staging switch, and mark 0.1, 0.2 and 0.5 PASS. Phase 0 would then be **COMPLETE for engineering and staging readiness**, with production release steps tracked separately.
