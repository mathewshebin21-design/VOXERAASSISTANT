# VOXERA Phase Tracker

Status legend: **Verified** (evidence linked) · **Blocked** (named blocker) · **Not run**.
Assumptions are listed separately from verified results.

## Phase 0/1: RC-1 isolated Preview validation

Updated 2026-11-06. Validation branch `codex/rc1-validation`.

| # | Item | Status | Evidence / blocker |
|---|------|--------|--------------------|
| 1 | Restricted-runtime RC-1 profile merged to validation branch | Verified | PR #9, merge `9a9be1c`; RC-1 unit suite green |
| 2 | Build log names the refusing RC-1 gate (no values printed) | Verified | PR #10, merge `9bf56ed`; CI `guards`, `test`, `live-e2e` green on head `ddbcf3d` |
| 3 | Branch-only profile vars (`VOXERA_DEPLOYMENT_PROFILE`, `VOXERA_EXPECT_DB_ENV`) | Verified | Vercel voxera-api, Preview, gitBranch `codex/rc1-validation` |
| 4 | All 20 `LEGACY_KEYS` masked by branch-scoped empty plain overrides | Verified (config) | Env metadata: 20/20 keys `type: plain`, `value: ""` on the branch; 16 shadow shared Preview values, 4 have no shared value (defensive masks) |
| 5 | Masking takes effect in a hosted build | Verified | `dpl_CdMA8soe68Mza1JxTbcexvwXxeGu` (commit `9bf56ed`, after all 20 masks): `REFUSING TO DEPLOY: RC-1 requires an independent JWT signing secret.` The inherited-credential gate runs first and passed; no database connection was made |
| 6 | Web Preview targets the RC-1 API | Configured | voxera-flow `VOXERA_API_URL` branch override → `voxera-api-git-codex-rc1-validation-ai-e399.vercel.app`; proven at runtime by `/api/rc1-identity` (item 9) |
| 7 | Branch-only secrets `VOXERA_DATABASE_URL`, `VOXERA_BUILD_DATABASE_URL`, `VOXERA_JWT_SECRET` | Set by owner; URL rejected | Metadata: all three `sensitive`, Preview, branch `codex/rc1-validation` (values never read). `dpl_BjVwyfLEh8wXkWTocCY3DB3bEDWR` (`9bf56ed`): JWT gate passed, then `RC-1 VOXERA_DATABASE_URL must use the dedicated database, TLS and voxera_app.` Owner to correct the value; rule names are reported from this PR on |
| 8 | Build preflight against dedicated DB (role `voxera_app`, `neondb`, marker `staging`, schema `0007`) | Not run | Depends on 7 |
| 9 | Runtime isolation gate (`/rc1-identity`, `/api/rc1-identity`, `scripts/rc1-isolation.mjs`) | Built, not run hosted | 18 gate unit tests; 4 API tests. Runs in workflow `rc1-hosted` before any write |
| 10 | Hosted synthetic acceptance | Not run hosted | Suite rehearsed locally: 102/104 pass; the 2 misses were suite artifacts (short SHA, non-RC-1 local profile), fixed. See `docs/rc1-hosted-acceptance-matrix.md` |
| 11 | Production isolation | Verified (unchanged) | No production deploy, claim, migration or setting change in this phase |

## Defects found and fixed in this phase

| ID | Defect | Fix | Regression test |
|----|--------|-----|-----------------|
| D1 | Build refusal hid which RC-1 gate failed | PR #10 (`ConfigError`, fixed text) | `tests/test_rc1_build.py::RefusalTextTests` |
| D3 | URL refusal did not say which rule failed, so a mis-entered secret could not be diagnosed without reading it | Refusal names the failed rule(s) in fixed words, never the value | `tests/test_rc1_preview_config.py::test_url_refusal_names_the_failed_rule` |
| D2 | WCAG AA colour contrast: white on `cmd-violet` (4.23:1) on Command login/landing buttons | `cmd-violet-strong` token (5.7:1) for solid fills under white text | `scripts/contrast.test.mjs`; axe scan in `previews` CI |

## Findings requiring owner decision (not changed)

| ID | Finding | Evidence | Risk | Recommendation |
|----|---------|----------|------|----------------|
| F1 | Production API runs with `VOXERA_ENV` unset, i.e. `development` defaults | Production env metadata lists no `VOXERA_ENV` or `VOXERA_EXPOSE_INVITE_TOKENS`; `config.py` defaults `env=development`, `expose_invite_tokens=True` | Invitation tokens are returned in API responses instead of travelling only by e-mail (accept still requires the matching e-mail address); `/docs` exposed; no HSTS header; production-safety assertion (`assert_production_safe`) skipped | Separately approved production change: set `VOXERA_ENV=production` and `VOXERA_EXPOSE_INVITE_TOKENS=false`, then verify sign-in, invitations and `/docs` 404 |
| F2 | Login rate limiter is in-process memory | `app/ratelimit.py` | On serverless, attempts spread across instances may not be throttled | Hosted `rate-limit` check measures it; durable limiter if it fails |

## Assumptions (not verified here)

- The dedicated Neon project `voxera-rc1-validation` is at identity `staging`, schema `0007`,
  with `voxera_app` (non-superuser, no BYPASSRLS) and SELECT on `alembic_version`, per
  `docs/rc1-preview-runtime.md`. This session has no Neon access; the build preflight and
  the runtime isolation gate verify it from the deployment itself.
