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

## 6. Migrate production to 0008 ⛔ (before merging PR #2)
- `db-migrate` production **check**, expecting "schema at 0007; pending 0008". Then action **upgrade**.
- 0008 is additive: four new Agent Studio tables with row-level security. The PR #1 code now live ignores them.
- **Check:** **check** again, expecting "schema at 0008; pending none".

## 7. Merge PR #2 and deploy ⛔
- Merge with a merge commit. The production build's preflight should pass ("production, schema at 0008") and deploy.
- **Checks:**
  - `/healthz` → the new commit;
  - `/readyz` → 200;
  - sign in;
  - the Agent Studio opens and shows the default flow;
  - a test call works;
  - existing pages are unchanged.

## 8. After the release ⛔ (separately)
- **Production database password rotation:** recommended because of the old previews. It changes the derived JWT secret, so everyone is signed out, and the app role's password, so re-run `db-migrate` production **upgrade** to reset the role. Plan it for a quiet time.
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
