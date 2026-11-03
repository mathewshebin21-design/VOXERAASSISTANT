# Deployment, environments and rollback

## Environments

| | Production | Staging (and every preview) |
|---|---|---|
| Code | branch `claude/confident-shannon-7nb05f` (the production branch) | branch `staging`; every other branch gets its own preview |
| Web | https://voxera-flow.vercel.app | `https://voxera-flow-git-staging-ai-e399.vercel.app` (and `voxera-flow-git-<branch>-…`) |
| API | https://voxera-api-two.vercel.app | `https://voxera-api-git-staging-ai-e399.vercel.app` (and `voxera-api-git-<branch>-…`) |
| Database | Neon project **voxera-db**, connected to voxera-api for **Production only** | Neon project **voxera-staging**, connected to voxera-api for **Preview and Development** |
| Database marker | `production` | `staging` |
| Web → API (`VOXERA_API_URL`) | production API (Production target) | staging API (Preview and Development targets) |

### What keeps them apart
1. **Different databases, by Vercel environment.** Each Neon store is connected only to the environments in the table. A preview deployment never receives production's connection strings.
2. **Different derived secrets.** The API's runtime database password and JWT signing secret are derived from the connected database's owner password (`app/platform.py`). Staging therefore signs its own tokens: a production session is not valid on staging, and the reverse is also true.
3. **A database marker, checked twice.** `scripts/migrate.py --claim` marks each database `production` or `staging`. The API role can read the marker but not change it.
   - **At build time**, the read-only preflight in `scripts/vercel_build.py` refuses to deploy a preview onto a database that isn't `staging`, or production onto one that isn't `production`. Vercel then keeps the current deployment.
   - **At run time**, `app/main.py` answers every request except `/healthz` with 503 when the marker doesn't match. A misconfigured preview can neither change production nor serve its data.
4. **No database access in the web app.** The web app holds no database credentials; it only knows its API's URL.
5. **No production-only settings in previews.** `VOXERA_ENV=production` and any AI or voice keys are set for Production only.

## Migrations: explicit, never in a build
Builds never change a database. Schema changes are made only by `services/api/scripts/migrate.py`, for one named environment:

```
python scripts/migrate.py --env staging --check          # state and pending migrations; changes nothing
python scripts/migrate.py --env staging                  # runtime role + upgrade to head
python scripts/migrate.py --env production --claim --confirm-host <host>   # first run on a database
python scripts/migrate.py --env production --downgrade-to 0006 --yes       # schema rollback
```

- A run for the wrong environment stops before changing anything.
- A database must be claimed once. Claiming needs its host typed back. Without the host, `--claim-if-empty` claims only a database that is still completely empty: a new staging database qualifies, and production never does.
- The connection comes from `DATABASE_URL_UNPOOLED`, the owner connection that Vercel's Neon integration provides.
- **Running deployments are never locked out.** Every run first logs in as the runtime role (`voxera_app`) with the password it would set, and reports the result (`--check` included).
  - The role is missing: it's created.
  - The password already matches: the role is left as it is, so deployments already running keep their database access.
  - It doesn't match, or can't be verified: the run stops before changing anything. This happens, for example, when the deployments were built from a different owner password than this run's connection. Fix the connection rather than overriding.
  - `--reset-runtime-role` overrides this, for a deliberate credential rotation only (deployments built before it lose access). The `db-migrate` workflow doesn't offer it.

Where it runs:
- **Staging:** automatically, in the `staging` GitHub workflow, whenever the `staging` branch is pushed. That workflow then waits for the staging deployments of the commit and runs the isolation check and the browser tests against staging.
- **Production:** only by hand, with the `db-migrate` workflow (Actions → db-migrate → Run workflow → environment `production`). Its secret lives in the GitHub environment `production`. Restrict that environment to the owner.

## One-time setup (owner, in the Vercel and GitHub dashboards; all free)
1. **Create the staging database.** In Vercel → Storage → Create Database → Neon:
   - plan **Free**, region **London (lhr1)**, name **voxera-staging**, Auth **off**;
   - connect it to **voxera-api** for **Preview** and **Development** only.
2. **Limit production's database to production.** In Vercel → voxera-api → Storage → **voxera-db** → edit the connection, and keep only **Production**.
3. **Remove the unused database from the web app.** In Vercel → voxera-flow → Storage → **neon-cobalt-flask** → disconnect. The web app never uses it. Delete the store too once you've checked it holds nothing you need.
4. **Add GitHub secrets.** In the repository: Settings → Secrets and variables → Actions.
   - `STAGING_DATABASE_URL_UNPOOLED`: from Vercel → Storage → voxera-staging → `.env.local` → `DATABASE_URL_UNPOOLED`.
   - Optional, `STAGING_API_DEPLOY_HOOK`: a deploy hook for voxera-api on branch `staging`. Vercel → voxera-api → Settings → Git → Deploy Hooks.
   - Environment `production` (Settings → Environments → New): secret `DATABASE_URL_UNPOOLED` from voxera-db. Restrict who can deploy to it if your plan offers that.
5. **Point preview web apps at the staging API.** In Vercel → voxera-flow → Environment Variables:
   - `VOXERA_API_URL` for Production stays `https://voxera-api-two.vercel.app`;
   - Preview and Development use `https://voxera-api-git-staging-ai-e399.vercel.app`.

## Releasing a change
1. Push the change to `staging`. The `staging` workflow migrates the staging database, waits for the deployments, and runs the isolation and browser checks. All must pass.
2. Open or review the pull request. GitHub CI must be green.
3. If the change adds migrations, run `db-migrate` for **production** with `check`, then `upgrade`. Migrations are written to be additive, so the code still in production keeps working on the newer schema. Run this before merging.
4. Merge into the production branch. The production build's preflight confirms the database is `production` and at the code's migration head, then deploys.
5. Confirm production:
   - `GET https://voxera-api-two.vercel.app/healthz` shows the merged commit;
   - `/readyz` returns 200;
   - sign in to the web app.

If step 4's preflight refuses because migrations weren't run, nothing changes. The previous deployment stays live, so run step 3 and redeploy.

### First production release of the isolation work (PR #1)
The production database is at migration 0006 and has no marker yet. Choose either:
- Run the production migration before merging:
  1. `vercel env pull --environment=production`, then `uv run python scripts/migrate.py --env production --claim --confirm-host <host>`, from `services/api`;
  2. merge.
- Or merge first:
  1. merge. The production build refuses safely and the current version stays live;
  2. Actions → `db-migrate` → environment `production`, action `claim`, with the host typed back;
  3. redeploy production from Vercel.

## Rolling back
- **Application:** in Vercel → voxera-api (and voxera-flow) → Deployments, open the previous production deployment and choose **Instant Rollback**, or **Promote to Production**.
  - This is safe because migrations are additive: older code works on the newer schema.
  - Confirm with `/healthz` (commit) and `/readyz`.
- **Schema:** run `db-migrate` with action `downgrade` and the target revision, or run `migrate.py --downgrade-to <rev> --yes`.
  - Downgrades drop what the migration added. Going below 0006 drops open usage reservations. Going below 0007 drops the environment marker, and the database must be claimed again after upgrading.
  - Roll the application back first, then the schema.
- **Data:** Neon keeps a restore window for point-in-time recovery. Check its length on your plan in the Neon console before relying on it. Restore into a new branch, check it, then switch the connection.
