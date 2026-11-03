# Production release plan: PR #1, migrations 0007/0008, PR #2

**Status: plan only. Nothing here is authorised to run.** Every step marked ⛔ needs the owner's explicit approval at the time.
Prepared 2026-11-02 after staging run #1 passed (staging at 94dae66: claimed, migrated to 0008, isolation ✅, browser checks 14/14 and 131/131).

## Where things stand
| | Now |
|---|---|
| Production branch | `claude/confident-shannon-7nb05f` (also the repository's default branch), at `767c0f2` |
| Production deployments | voxera-api `dpl_EEBqGurCwGj7mWkhzWNGQSo4JWiA` and voxera-flow, both at `767c0f2` |
| Production database | voxera-db (Neon `cool-block-14364291`), Production-only. Believed to be at **0006** with **no environment marker**, because a PR #1 preview build migrated it on 2026-11-02. Confirm with the read-only check in step 3 |
| PR #1 | `claude/stoic-davinci-vvk3jg` → production branch, head `a7ba2f0`. Adds 0006 (already applied) and 0007 (the marker), explicit migrations, the read-only build preflight and the runtime guard |
| PR #2 | `claude/agent-studio` → PR #1's branch, head `41a4a13`. Adds 0008 (Agent Studio tables) and the Agent Studio |
| Staging | verified on 0008, as above |

**Two constraints shape the order:**
1. **The production build refuses unless the database is claimed `production` and at the code's migration head.** If anything is out of order, the merge deploys nothing and the current site stays live. That's safe, but it's a no-op until the database is ready.
2. **`db-migrate` can't run yet.** GitHub only offers manually-triggered workflows that exist on the default branch, which here is the production branch. `db-migrate.yml` arrives with PR #1, so it can't be used *before* PR #1 merges. The first production claim therefore happens either after the merge (option A, recommended) or by the owner running `migrate.py` locally (option B).

## Findings from the Phase 0 compatibility tests (2026-11-02, disposable databases)
Each finding was proven against the real commits on throwaway databases (40/40 compatibility checks):
- **Production is already one revision ahead of its code.** `767c0f2` ships migrations 0001–0005, but the database is at 0006. The 0006 migration was applied by the PR #1 preview build `dpl_3mGpaVh2…` ("Running upgrade 0005 -> 0006"). `767c0f2` runs normally on 0006, 0007 and 0008.
- **`767c0f2` cannot be rebuilt.** Its build runs `alembic upgrade head` and fails with "Can't locate revision 0006", changing nothing. Roll back to it **only with Instant Rollback** (no rebuild), never with "Redeploy".
- **PR #1's code (`a7ba2f0`) runs on 0008 but refuses to *build* there** ("schema is at 0008, this code needs 0007"). After 0008, go back to PR #1 only with Instant Rollback.
- **`--claim` and `upgrade` migrate to the head of the code they run.** Always run `db-migrate` with **"Use workflow from: `claude/confident-shannon-7nb05f`"** (the production branch), and restrict the GitHub `production` environment to that branch. Running from `claude/agent-studio` in step 3 would jump straight to 0008, and step 4's build would then refuse.
- **Correction (2026-11-03 review, finding M1):** the 0008 upgrade can't run from the production branch *before* PR #2 merges, because that branch's head is still 0007. So steps 6 and 7 are reordered: merge PR #2 first (its build refuses and PR #1 stays live), then upgrade from the production branch and redeploy. Every production migration then comes from reviewed, merged code.
- **Neon Free plan:** a 6-hour point-in-time restore window (capped at 1 GB of history) and **1 manual snapshot**. Take the snapshot or branch in step 0, immediately before step 3.

## 0. Prerequisites ⛔ (owner, dashboards; free)
1. **Backup point.** In the Neon console for voxera-db, create a branch, for example `pre-release-2026-11-xx`, from the current state. This is the fastest way to restore. Also note the restore window your plan offers.
2. **GitHub environment `production`.** Settings → Environments → New environment `production`:
   - secret `DATABASE_URL_UNPOOLED` = voxera-db's `DATABASE_URL_UNPOOLED`. Never paste it into chat or a commit.
   - Add a required reviewer (the owner) if the plan allows it, so `db-migrate` against production always pauses for approval.
3. **Old preview cleanup.** Decide on Deployment Protection and on deleting the 16 historical previews before or alongside the release. See the tracker's preview inventory. It's independent of this plan, but it closes the production-credential exposure.
4. **Quiet window.** Pick a low-traffic time. No downtime is expected, but the release ends with checks on production.

## 1. Merge PR #1 ⛔ (merge, don't squash)
- Use **"Create a merge commit"**. Squashing would rewrite PR #1's history and make PR #2 conflict.
- **Expected:** the production build for the merge commit runs the read-only preflight, finds no `production` marker, and **refuses to deploy**. The current `767c0f2` deployment stays live. Users see no change.
- **Check:** Vercel → voxera-api → the new production deployment shows "REFUSING TO DEPLOY … not been claimed". Production `/healthz` still reports `767c0f2`.

## 2. Read-only check of the production database ⛔
- Actions → `db-migrate` → Run workflow: environment `production`, action **check**.
- **Expected output:** "claimed for: nobody yet; schema at 0006; code head 0007; pending: 0007", with nothing changed.
- If the reported host or schema isn't what's expected, **stop**.

## 3. Claim and migrate production to 0007 ⛔
- `db-migrate`: environment `production`, action **claim**, `confirm_host` = the voxera-db host shown in step 2's output (typed back exactly).
- **This:**
  - takes the migration lock;
  - sets up the runtime role;
  - upgrades 0006 → 0007 (additive: one table plus the marker);
  - marks the database `production`.
- The still-live `767c0f2` code keeps working on 0007, because the migration only adds.
- **Check:** run **check** again and expect "claimed for: production; schema at 0007; pending: none".

## 4. Deploy PR #1 to production ⛔
- Vercel → voxera-api → Deployments → the refused production deployment from step 1 → **Redeploy**. Then the same for voxera-flow, if its production build didn't already succeed.
- **Expected:** the preflight reports "database preflight passed (production, schema at 0007)", then the deploy.
- **Checks:**
  - `GET https://voxera-api-two.vercel.app/healthz` → the merge commit;
  - `/readyz` → 200;
  - sign in at https://voxera-flow.vercel.app with a real account;
  - the existing workspace data is visible;
  - the setup assistant opens.
- If any check fails, roll back the application (R1).

## 5. PR #2: rebase target, CI, staging ⛔
- After PR #1 merges, GitHub retargets PR #2 onto the production branch. If GitHub reports a conflict, merge the production branch into `claude/agent-studio` (no rebase) and re-run CI.
- Optionally push PR #2's head to `staging` and run the staging workflow again to re-verify. That's an approval of its own, and the staging database is already at 0008, so no migration would change.

## 6. Merge PR #2 ⛔ (merge commit; the build is expected to refuse)
- Merge with a merge commit. **Expected:** the production build refuses ("schema is at 0007, this code needs 0008"). PR #1's deployment stays live.

## 7. Migrate production to 0008, then deploy PR #2 ⛔
- `db-migrate` production **check**, from the production branch, expecting "schema at 0007; code head 0008; pending 0008". Then action **upgrade**.
- 0008 is additive: four new Agent Studio tables with row-level security. The PR #1 code still live ignores them (verified on a disposable copy).
- Run **check** again, expecting "schema at 0008; pending none".
- Redeploy the refused production build from step 6. The preflight should pass ("production, schema at 0008").
- **Checks:**
  - `/healthz` → the new commit;
  - `/readyz` → 200;
  - sign in;
  - the Agent Studio opens and shows the default flow;
  - a test call works;
  - existing pages are unchanged.

## 8. After the release ⛔ (separately): revoke the old previews' production credentials
Rotation must come **after** PR #1 is live. `767c0f2` cannot be rebuilt, so rotating while it is still production would leave no way to redeploy it with the new password.
1. **Optional first:** set `VOXERA_JWT_SECRET` (Production only, random 64-hex) and redeploy. Sessions then no longer depend on the database password, so this rotation and later ones don't affect them. The change itself only forces one silent refresh per signed-in browser, because refresh tokens are opaque and stored in the database. See `docs/production-release-runbook.md` §5.
2. Rotate voxera-db's owner password in Neon. The Vercel integration updates voxera-api's Production variables, but running deployments keep the old password until redeployed.
3. Update the GitHub `production` environment secret `DATABASE_URL_UNPOOLED` to the new value.
4. Run `db-migrate` production **upgrade**. This resets the `voxera_app` role's password to the value derived from the new owner password. **From here until step 5 completes, the live API cannot connect** (expect about 1–3 minutes of 503 responses).
5. Redeploy production (API and web) immediately, then check `/readyz` and sign-in.

**What this does:** every older deployment, including the 8 old previews, older production deployments and rollback targets, can no longer reach the database. After rotation, Instant Rollback to a pre-rotation deployment would also fail to connect.

## Old preview deployments ⛔ (before the release if possible)
Preview deployments on these projects are publicly reachable: the staging workflow's unauthenticated runner read their JSON. Deleting the 8 old voxera-api previews (`b1adb59` … `469283d`) removes the only deployments that hold production database credentials, without rotating anything. This is the fastest mitigation. Rotation (step 8) then covers anything already copied.
- **Update the tracker:** record the production commit, schema 0008 and the checks run.

## Rollback
| Situation | Do this | Data impact |
|---|---|---|
| **R1. App broken after step 4 or 7** | Vercel → voxera-api and voxera-flow → previous production deployment → **Instant Rollback**. Check `/healthz` and `/readyz` | None. Migrations are additive, so older code runs on the newer schema |
| R2. 0008 must come out | First R1 to pre-PR #2 code, then `db-migrate` **downgrade** `downgrade_to=0007` | **Drops all Agent Studio flows, versions, sessions and tests** |
| R3. 0007 must come out | First R1 to `767c0f2`, then `db-migrate` downgrade `downgrade_to=0006` | Drops the marker. A later upgrade needs **claim** again (step 3) |
| R4. Data damaged | Neon: restore from the step 0 backup branch, or point in time, **into a new branch**. Check it, then switch the voxera-db connection | As at the restore point |

**Order matters:** roll back the application before the schema, and never downgrade below the schema the live code needs.
**Stop conditions:**
- the preflight or the migration names an unexpected host;
- **check** shows a schema other than expected;
- the runtime guard returns 503 on production;
- sign-in fails after a deploy.

At any stop condition, roll back the application, keep the schema as it is, and report.
