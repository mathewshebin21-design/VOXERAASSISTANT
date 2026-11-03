# Production release runbook

Companion to `docs/production-release-plan.md` (the order of steps) and `docs/pr1-review.md`.
**Status: prepared, not executed.** Every ⛔ step needs the owner's explicit approval at the time.
Prepared 2026-11-03.

## 1. Prerequisite status (2026-11-03)
| Prerequisite | Status | How it was checked / what's needed |
|---|---|---|
| GitHub CI, PR #1 at `a7ba2f0` | ✅ 7/7 green | GitHub checks |
| GitHub CI, PR #2 at `359aa31` | ✅ all green | GitHub checks |
| Merge simulation | ✅ clean for both | `git merge-tree` against `767c0f2` |
| Release path on disposable databases | ✅ 51/51; compatibility 40/40 | local Postgres 16 |
| PR #1 code review | ✅ approve; M1 fixed in the plan, M2 needs the owner setting below | `docs/pr1-review.md` |
| Production health | ✅ `dpl_EEBq…` at `767c0f2`, READY, 0 runtime errors in 24 h | Vercel, read-only |
| Production credentials isolated | ✅ 16 voxera-db variables Production only; `VOXERA_ENV` Production only | Vercel variable listing (names and targets only) |
| `VOXERA_JWT_SECRET` | ⚠️ not set (signing secret derived from the database password) | Vercel variable listing |
| **GitHub `production` environment** | ❓ **unverified**. This session's GitHub access can't read environments or secret names (HTTP 403 from the proxy). | Owner checks: Settings → Environments → `production` exists; secret **`DATABASE_URL_UNPOOLED`** present; **Required reviewers**: the owner; **Deployment branches**: "Selected branches", default branch `claude/confident-shannon-7nb05f` only; *Prevent self-review* off (a single owner must be able to approve). |
| **Neon backup point** | ❌ not taken | Section 2 |
| **PR #1 approved by the owner** | ❌ no review yet | GitHub |
| Preview Deployment Protection | ❓ unconfirmed (optional) | Vercel → each project → Settings → Deployment Protection |

`db-migrate.yml` only becomes runnable once PR #1 has merged, because manually triggered workflows must exist on the default branch.

## 2. Neon backup and restore checklist (voxera-db, Neon project `cool-block-14364291`)
**The Free plan's limits shape this:**
- **Instant (point-in-time) restore covers only the last 6 hours**, capped at 1 GB of change history.
- **One manual snapshot.**
- Instant restore works on root branches only.
- A branch created *from* a snapshot can't use point-in-time restore yet.

So a restore point older than 6 hours exists only if you make one.

### 2a. Before the first production migration (immediately before RC-1 step 3) ⛔ owner
1. **Note the time (UTC)** to the minute: `T0 = ____`. This is the instant-restore target if needed within 6 hours.
2. In the Neon console, open **project `cool-block-14364291`** and confirm it's voxera-db. Its host must equal Vercel → voxera-api → Production `PGHOST`.
3. **Create a branch** from the production (root) branch at "current point in time". Name it `pre-release-2026-11-XX`, with no compute needed. A branch is a copy-on-write copy that persists beyond the 6-hour window.
4. **Take the one manual snapshot** as well, if available (Backup & restore → Create snapshot). If the snapshot slot is already used, the branch from step 3 is the backup; don't delete the old snapshot without checking what it holds.
5. **Record the evidence:** branch name and id, snapshot id and time, the production branch's row counts (Neon SQL editor, read-only: `select count(*) from organizations; select count(*) from users; select version_num from alembic_version;`).
6. Don't start step 3 of the release more than about **1 hour** after T0. A longer gap means writes the backup doesn't hold.

### 2b. Restore options, fastest and least destructive first
| Situation | Restore | Notes |
|---|---|---|
| Damage spotted **within 6 h of T0**, wanting to inspect first | Neon → production branch → **Restore** to a point in time, using the *preview / create new branch* option to look first | Read-only inspection before anything changes |
| Damage within 6 h, confirmed | **Instant restore of the production branch** to `T0` (or just before the damaging step) | Neon keeps the pre-restore state as a backup branch automatically. The host and credentials stay the same, so no Vercel change |
| Older than 6 h | **Snapshot restore, one-step, into the production branch**, or restore the production branch **from the `pre-release-…` branch** | The connection stays the same. Writes after the backup are lost: export them first if they matter |
| Want to test the backup first | Multi-step snapshot restore into a **new branch**, verify, then one-step restore into production | A new branch has a different host. Pointing Vercel at it is a cloud setting change and isn't recommended |

**After any restore** ⛔:
1. Run `db-migrate` **check**, and confirm the reported schema and marker match what the live code needs. A restore to before step 3 means schema 0006 and **no marker**: roll the app back to `767c0f2` first (Instant Rollback), then repeat the release later.
2. Check `/readyz` → 200, and a real sign-in works.
3. Log the restore point, the reason and the data-loss window in the tracker.

### 2c. Order rule
Roll the **application** back first, then the schema or data. Never restore or downgrade the database below the schema the live code needs.

## 3. Deployment-by-deployment validation checklist
Run the checks for each deployment immediately after it reaches READY. Record the results in the tracker.

**Common checks (every production deployment)**
1. **Vercel build log:** `database preflight passed (production, schema at <expected>)`. Any `REFUSING TO DEPLOY` means it didn't deploy, and the previous deployment is still live.
2. **`GET https://voxera-api-two.vercel.app/healthz`:** `{"status":"ok","commit":"<7-char sha of this deployment>"}`. (`767c0f2` itself returns `{"status":"ok"}` with no commit.)
3. **`GET /readyz`:** 200. A 503 with a "not connected to its own environment's database" reason means **stop**.
4. **https://voxera-flow.vercel.app:** sign in with a real owner account; the workspace, services, hours and desk show the existing data.
5. **Vercel → voxera-api → runtime errors**, last 15 minutes: none new.
6. **Staging untouched:** the staging API `/staging-identity` still reports `staging`.

| Deployment | Expected schema | Extra checks |
|---|---|---|
| **D1: PR #1 merge build** (RC-1 step 1) | — | **Expected to refuse:** "has not been claimed for production". Production `/healthz` must still show no commit (`767c0f2`). If it *deployed*, stop: the database was already claimed by someone |
| **D2: PR #1 redeploy** (RC-1 step 4) | 0007 | Setup assistant opens and its free step-by-step mode answers. Practice receptionist (Simulate) answers from the workspace. Desk loads cases. Book, then cancel, a test appointment in a test workspace only |
| **D3: PR #2 merge build** (RC-2, reordered) | — | **Expected to refuse:** "schema is at 0007, this code needs 0008". `/healthz` still shows PR #1's merge commit |
| **D4: PR #2 redeploy** (after the 0008 upgrade) | 0008 | Agent Studio opens and shows the default flow. The Testing Lab runs 12/12. A test call books, and nothing is saved. Existing pages unchanged |
| **D5: `VOXERA_JWT_SECRET` redeploy** (optional) | unchanged | Already signed-in browsers keep working after one page action (a silent refresh). New sign-in works. See section 5 |
| **D6: password rotation redeploy** | unchanged | `/readyz` 200 within 3 minutes of the role reset. Sign-in works. Instant Rollback targets from before the rotation are now **unusable** |

## 4. Rollback decision tree
```
Deployment finished?
├─ Build REFUSED ─────────────── Expected for D1 and D3: continue the plan.
│                                Unexpected (D2, D4, D5, D6): nothing changed; the live deployment is the previous one.
│                                Read the reason → fix the precondition (claim, schema) → redeploy. No rollback needed.
└─ Build DEPLOYED
   ├─ /readyz 503 "not connected to its own environment's database"
   │     → Instant Rollback to the previous production deployment NOW; then db-migrate check; report.
   ├─ /readyz 503 other / 5xx errors / sign-in fails / data missing
   │     → Instant Rollback (R1). Do NOT touch the schema yet.
   │       ├─ App healthy after rollback → leave the schema; investigate on staging; report.
   │       └─ Still broken after rollback → data or schema problem:
   │             ├─ caused by 0008 → db-migrate downgrade to 0007 (R2: Agent Studio data lost)
   │             ├─ caused by 0007 → only after rolling back to 767c0f2: downgrade to 0006 (R3)
   │             └─ data damaged → Neon restore (section 2b, R4)
   └─ Checks pass → record in tracker; continue to the next approved step.
```
**Rollback targets (verified):**
- before PR #2 is live: PR #1's production deployment;
- before PR #1 is live: **`dpl_EEBqGurCwGj7mWkhzWNGQSo4JWiA` (`767c0f2`) only, by Instant Rollback**, never "Redeploy".

Older candidates (`dpl_BWTf…` / `8bd89e6` and earlier) are untested on the new schema and must not be used.
**After a credential rotation:** pre-rotation deployments can't connect, so there's no rollback past the rotation without the old password.

## 5. JWT signing secret: review and transition
**Today:**
- `jwt_secret = HMAC-SHA256(owner password, "voxera:jwt")` (`app/platform.py`), unless `VOXERA_JWT_SECRET` is set (`app/config.py`, where explicit variables win).
- Access tokens are HS256 JWTs lasting 15 minutes.
- **Refresh tokens are opaque random tokens, stored only as digests in the database**, so they don't depend on the JWT secret.
- The web app's server-side proxy (`app/api/v1/[...path]/route.ts`) refreshes and retries once when the API returns 401.

**What changing the secret does:**
- Every outstanding access token fails at once.
- The proxy refreshes each session with its refresh token, so **signed-in users stay signed in**; their next request does one silent refresh. In effect, every session's 15-minute access token expires at the same moment.
- The only sign-outs come from the existing refresh-reuse protection. If one browser sends two requests that hit *different* serverless instances and both refresh with the same token, the second refresh is treated as theft and that session ends. That's rare, and the same race exists at every normal 15-minute expiry.
- (This corrects the plan's earlier statement that setting the secret "signs everyone out once".)

**Safest transition (no code change):**
1. ⛔ Generate a random 64-hex-character secret on the owner's machine (`openssl rand -hex 32`). Never paste it into chat, a commit or a ticket.
2. ⛔ Vercel → voxera-api → Settings → Environment Variables → add `VOXERA_JWT_SECRET`:
   - **Production only**;
   - marked *Sensitive*.

   It takes effect only at the next production deployment.
3. Do this **before** RC-1 step 4, so the D2 redeploy carries it and sessions switch once, at the same deployment as PR #1. Otherwise, do it as its own redeploy, D5, in a quiet hour.
4. **Validate (D5):**
   - a browser already signed in keeps working after one click;
   - a new sign-in works;
   - `/readyz` returns 200.
5. **Rollback:** delete the variable and redeploy. Sessions refresh once more, onto the derived secret.

From then on, rotating the database password (release plan step 8) no longer affects sessions at all.

**Optional zero-impact variant (code change, separate approval):** accept a `VOXERA_JWT_SECRET_PREVIOUS` for *verification only*, during one access-token lifetime (15 min). Tokens stay valid across the switch with no refresh storm. About 15 lines plus tests; worth doing before any future scheduled rotation.

## 6. Recommended first authorised action
**The owner's prerequisites, which are dashboard-only and change nothing in production:**
1. confirm or create the GitHub `production` environment, with the secret, the required reviewer and the default-branch-only rule;
2. approve PR #1 on GitHub after reading `docs/pr1-review.md`.

The Neon backup branch (section 2a) is taken **immediately before** RC-1 step 3, not now, so that it's fresh.
