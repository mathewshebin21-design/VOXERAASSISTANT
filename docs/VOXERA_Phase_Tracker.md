# VOXERA Phase Tracker

Status legend: **Verified** (evidence linked) · **Blocked** (named blocker) · **Not run**.
Assumptions are listed separately from verified results.

## Phase 0/1: RC-1 isolated Preview validation

Updated 2026-11-06. Validation branch `codex/rc1-validation` at `ad98ff6`. **Phase 0/1 gates: all passed on the isolated hosted Preview.**

| # | Item | Status | Evidence / blocker |
|---|------|--------|--------------------|
| 1 | Restricted-runtime RC-1 profile merged to validation branch | Verified | PR #9, merge `9a9be1c`; RC-1 unit suite green |
| 2 | Build log names the refusing RC-1 gate (no values printed) | Verified | PR #10, merge `9bf56ed`; CI `guards`, `test`, `live-e2e` green on head `ddbcf3d` |
| 3 | Branch-only profile vars (`VOXERA_DEPLOYMENT_PROFILE`, `VOXERA_EXPECT_DB_ENV`) | Verified | Vercel voxera-api, Preview, gitBranch `codex/rc1-validation` |
| 4 | All `LEGACY_KEYS` absent or empty in the RC-1 build | Verified | 16 inherited keys masked by branch-scoped empty plain overrides. `PGSERVICE`, `PGSERVICEFILE` and `PGPASSFILE` have no shared value and are now absent; their empty masks were retired (renamed `RC1_RETIRED_MASK_*`) because libpq treats an empty `PGSERVICE` as a service-file lookup (D5) |
| 5 | Masking takes effect in a hosted build | Verified | `dpl_CdMA8soe68Mza1JxTbcexvwXxeGu` (commit `9bf56ed`, after all 20 masks): `REFUSING TO DEPLOY: RC-1 requires an independent JWT signing secret.` The inherited-credential gate runs first and passed; no database connection was made |
| 6 | Web Preview targets the RC-1 API | Verified | voxera-flow `VOXERA_API_URL` branch override; runtime gate `usesRc1Api=true` in `rc1-hosted` run 42297447382 |
| 7 | Branch-only secrets `VOXERA_DATABASE_URL`, `VOXERA_BUILD_DATABASE_URL`, `VOXERA_JWT_SECRET` | Verified | Sensitive, Preview, branch `codex/rc1-validation`, values never read. A first entry used the wrong user (refusal named `user voxera_app`); the owner reset the `voxera_app` password on the dedicated Neon project and re-entered both URLs |
| 8 | Build preflight against dedicated DB | Verified | `dpl_2sgg7BzGqgygVysYAn7YfYRPTVXR` (`9cb7a49`): restricted-role check passed (`voxera_app`, not superuser, no BYPASSRLS, `neondb`), then `database preflight passed (staging, schema at 0007).` Merge build at `ad98ff6` deployed the same way |
| 9 | Runtime isolation gate | Verified | `rc1-hosted` run 42297447382 (`ad98ff6`): before and after the suites, `Verified RC-1: commit, staging marker, schema 0007, restricted role, dedicated database, web upstream.` |
| 10 | Hosted synthetic acceptance | Verified | `rc1-hosted` run 42297447382 (`ad98ff6`): API 104/104 (5 notes), browser 14/14, accessibility 6/6 pages with 0 violations, synthetic accounts deleted. Evidence artifact `rc1-hosted-evidence-ad98ff6…` (ID 13542159106). Matrix: `docs/rc1-hosted-acceptance-matrix.md` |
| 11 | Production isolation | Verified (unchanged) | No production deploy, claim, migration or setting change in this phase |

## Defects found and fixed in this phase

| ID | Defect | Fix | Regression test |
|----|--------|-----|-----------------|
| D1 | Build refusal hid which RC-1 gate failed | PR #10 (`ConfigError`, fixed text) | `tests/test_rc1_build.py::RefusalTextTests` |
| D3 | URL refusal did not say which rule failed, so a mis-entered secret could not be diagnosed without reading it | Refusal names the failed rule(s) in fixed words, never the value | `tests/test_rc1_preview_config.py::test_url_refusal_names_the_failed_rule` |
| D4 | Database driver failures printed only a generic refusal | Fixed category, or SQLSTATE, or a redacted first line; classification runs on redacted text (PRs #12, #13) | `tests/test_rc1_build.py::DriverFailureTextTests`, `::RedactionTests` |
| D5 | Empty `PGSERVICE`/`PGSERVICEFILE`/`PGPASSFILE` masks broke libpq (`service file not found`) | Masks retired; these keys had no shared value, so absent is correct | Hosted build `dpl_2sgg7Bz…` passes preflight |
| D6 | Acceptance check required exactly 401 for `alg=none`; Vercel's edge refuses it first with 403 | Check asserts "never accepted (4xx, no user data)" and records the status (PR #14) | `tests/test_auth.py::test_unsigned_alg_none_token_is_rejected` (API returns 401) |
| D2 | WCAG AA colour contrast: white on `cmd-violet` (4.23:1) on Command login/landing buttons | `cmd-violet-strong` token (5.7:1) for solid fills under white text | `scripts/contrast.test.mjs`; axe scan in `previews` CI |

## Findings requiring owner decision (not changed)

| ID | Finding | Evidence | Risk | Recommendation |
|----|---------|----------|------|----------------|
| F1 | Production API runs with `VOXERA_ENV` unset, i.e. `development` defaults | Production env metadata lists no `VOXERA_ENV` or `VOXERA_EXPOSE_INVITE_TOKENS`; `config.py` defaults `env=development`, `expose_invite_tokens=True` | Invitation tokens are returned in API responses instead of travelling only by e-mail (accept still requires the matching e-mail address); `/docs` exposed; no HSTS header; production-safety assertion (`assert_production_safe`) skipped | Separately approved production change: set `VOXERA_ENV=production` and `VOXERA_EXPOSE_INVITE_TOKENS=false`, then verify sign-in, invitations and `/docs` 404 Rehearsed on RC-1 (branch-only `VOXERA_ENV=production`): `rc1-hosted` run 42345495531 at `3334bf9` passed in full (API 104/104, browser 14/14, a11y 6/6), `/docs` 404, HSTS present, startup safety check active. `VOXERA_EXPOSE_INVITE_TOKENS=false` not rehearsed: the hosted RBAC tests join members with exposed tokens |
| F2 | Login rate limiter is in-process memory | `app/ratelimit.py`; hosted check passed (429 within 8 attempts) in runs 42294005143 and 42297447382 | Throttling held in these runs, but could weaken if load spreads across more serverless instances | Consider a database-backed limiter before production scale |
| F3 | `/docs` exposed on the RC-1 Preview | Resolved on RC-1 by the F1 rehearsal: `/docs` returns 404 (run 42345495531) | None now | Keep `VOXERA_ENV=production` on the RC-1 branch |
| F4 | Retired mask entries remain in Vercel | `RC1_RETIRED_MASK_PGSERVICE`, `…PGSERVICEFILE`, `…PGPASSFILE` on branch `codex/rc1-validation` | None (unused names) | Owner may delete them in the Vercel dashboard |

## Assumptions and limits

- The dedicated database's identity was verified from the deployment itself: the build preflight
  and the runtime gate both report marker `staging`, schema `0007` and restricted role
  `voxera_app` on `neondb`. This session had no direct Neon access.
- The 403 for `alg=none` comes from outside the API's auth check. The API returns 401 for the same
  token (unit test D6), so the refusing layer is inferred to be Vercel's edge. It was never
  accepted either way.
- Not exercised on the hosted run: DST transitions (none within the 60-day horizon for the test
  zones) and expiry of tokens signed with the real key. Unit tests cover both.
