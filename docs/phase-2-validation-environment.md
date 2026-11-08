# Phase 2: dedicated validation databases for PRs #27 and #28

**Status:** prepared and verified, read-only.
- **Not done yet:** no migration has run, and no Vercel variable has been created or changed.
- **Unchanged:** shared staging (`main`) stays at 0009, and production is untouched.

## Why two branches

The build preflight requires the database to be at **exactly** the code's migration head:
- PR #27 (`claude/phase2-rate-limiter`) needs **0010**;
- PR #28 (`claude/phase2-call-records`) needs **0011**.

One database at 0011 would refuse PR #27's preview, just as staging at 0009 refuses both today. So each PR gets its own branch of staging. PR #28 contains PR #27, so its branch exercises both changes together.

## Branches (Neon project `voxera-staging`, `blue-night-16595257`, aws-eu-west-2)

| | PR #28 | PR #27 |
|---|---|---|
| Branch | `pr27-28-phase2-validation` | `pr27-phase2-ratelimit-validation` |
| Branch ID | `br-divine-poetry-zaxsxbs0` | `br-red-cherry-zaxx9s1o` |
| Parent | `main` `br-super-cake-za8v2xbj` (shared staging) | same |
| Compute (direct) | `ep-cool-butterfly-zasyi8tz.c-2.eu-west-2.aws.neon.tech` | `ep-plain-sound-zay6qypd.c-2.eu-west-2.aws.neon.tech` |
| Compute (pooled) | `ep-cool-butterfly-zasyi8tz-pooler.c-2.eu-west-2.aws.neon.tech` | `ep-plain-sound-zay6qypd-pooler.c-2.eu-west-2.aws.neon.tech` |
| Target schema | 0011 | 0010 |

## Identity and isolation evidence (read-only SQL, 2026-11-08)

| Check | Shared staging `main` | PR #28 branch | PR #27 branch | Production (`voxera-db`, `cool-block-14364291`) |
|---|---|---|---|---|
| Environment claim | `staging` | `staging` | `staging` | `production` |
| Schema | 0009 | 0009 | 0009 | 0009 |
| Workspaces / users | 0 / – | 0 / 0 | 0 / – | not read |
| Writable primary | – | yes | yes | – |
| Runtime role superuser or BYPASSRLS | – | no | no | – |
| Tables owned by runtime role | – | 0 | – | – |
| Tenant tables without RLS | – | 0 | 0 | – |
| Objects 0010/0011 would create already present | – | 0 | 0 | – |
| Other active sessions | – | 0 | – | – |

**Production is isolated by three things:**
- it is a separate Neon **project**;
- its database claims `production`, so every build preflight and every `migrate.py --env staging` run stops before touching it;
- the validation branches have their own compute endpoints, listed above.

## Migration check (0009 → head), PR #28 branch

The same facts `migrate.py --check` reports, gathered with read-only SQL:

```
claimed for: staging; schema at 0009; code head 0011; pending: 0010, 0011
conflicting tables: 0; conflicting functions: 0; app_org() present; runtime role can log in
```

The PR #27 branch reports the same with code head 0010 and pending 0010.

The migrations were reviewed earlier (`docs/phase-2-migration-rehearsal.md` §2). They:
- create objects only;
- give both new tables tenant isolation (RLS) and the composite tenant foreign key;
- give the runtime role no access to `rate_limit_hits` and make `call_events` append-only;
- have a tested downgrade to 0009.

They were rehearsed 0009 → 0011 → 0009 → 0011 on a production-shaped clone, with 350 checks passing and 0 failing.

## Configuration needed (for the owner's approval, not applied)

**Vercel project `voxera-api` (`prj_v7nIkN3DhcHf06E59ph5zum957s2`)**: four branch-scoped **Preview** variables of type *sensitive*.

| Git branch | Key | Value (owner connection; user `neondb_owner`, database `neondb`, `sslmode=require`) |
|---|---|---|
| `claude/phase2-call-records` | `DATABASE_URL` | pooled host `ep-cool-butterfly-zasyi8tz-pooler…` |
| `claude/phase2-call-records` | `DATABASE_URL_UNPOOLED` | direct host `ep-cool-butterfly-zasyi8tz…` |
| `claude/phase2-rate-limiter` | `DATABASE_URL` | pooled host `ep-plain-sound-zay6qypd-pooler…` |
| `claude/phase2-rate-limiter` | `DATABASE_URL_UNPOOLED` | direct host `ep-plain-sound-zay6qypd…` |

Branch-scoped variables take precedence over the generic Preview ones for that branch only.
- The API reads `DATABASE_URL` before `POSTGRES_URL`, so the generic staging variables are not used.
- **Shared Preview and Production variables are not modified.**

**Vercel project `voxera-flow` (`prj_UNehxb7XGlW91NHbqfNTp45yMpsk`)**: two branch-scoped **Preview** variables of type *plain*. These are not secret; PR #23 used the same pattern.

| Git branch | Key | Value |
|---|---|---|
| `claude/phase2-call-records` | `VOXERA_API_URL` | `https://voxera-api-git-claude-phase2-call-records-ai-e399.vercel.app` |
| `claude/phase2-rate-limiter` | `VOXERA_API_URL` | `https://voxera-api-git-claude-phase2-rate-limiter-ai-e399.vercel.app` |

## Controlled migration and acceptance (after approval)

1. **Migrate each branch with the real runner**, `migrate.py --env staging`, using that branch's owner connection:
   - PR #28's branch upgrades to head, 0011;
   - PR #27's branch upgrades to 0010 (from PR #27's own checkout, whose head is 0010).
   - The runner refuses unless the database claims `staging`, and leaves the runtime role's password unchanged.
2. Run `verify_release.py --env staging --expect 0011` and `--expect 0010` respectively (read-only).
3. Create the six variables above, then redeploy both branches' previews. The API build log must report "database preflight passed (staging, schema at 0011)" and "schema at 0010".
4. **Hosted acceptance.** `.github/workflows/phase2-hosted-acceptance.yml` is started by pushing `.github/rehearsal/phase2-hosted.request` to each branch. It runs:
   - the isolation gate: the branch API serves this commit; the web app routes to it; an account created there is refused by shared staging **and** by production;
   - then `scripts/phase2-hosted-acceptance.mjs`: the login limit (429 with `Retry-After`), and on PR #28 the call lifecycle, ordering, consent, cross-workspace 404s and erasure;
   - then the isolation gate again.
   - Probe accounts are deleted, and no paid provider is called.
   - The script passed both scopes locally against a 0011 database.

## Clean-up after validation

Delete both Neon branches, then the six branch-scoped Vercel variables. Neither touches shared staging or production.
