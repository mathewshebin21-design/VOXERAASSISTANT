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

## Phase 0/1 completion: production releases

Updated 2026-11-08. **Phase 0/1 is complete: design selection and authenticated design navigation
are released and verified in production at `931138e`, and the full customer-workflow suite passed
in production at `667eec1` (item 16).**

| # | Item | Status | Evidence / blocker |
|---|------|--------|--------------------|
| 12 | PR #20 design selection (schema 0009) in production | Verified | Merge `dd29ca1`; production API `dpl_EF3sA2hLu3t4XenobFqUWQDsDb9f` (2026-11-07 18:49 UTC). Procedure: `docs/release-pr20-design-selection.md` |
| 13 | PR #21 authenticated design navigation, no silent demo data | Verified | Merge `931138e`; production API `dpl_8gt2Pfqf9dbuLM58RQSDPY3U8GkE`, web `dpl_FZYuDuaSjXK35Z4pNnBcEpPQDUyR`. All six release gates passed. Production smoke 13/13 (run 42459985605) with probe clean-up proven; hosted acceptance 28/28 (run 42458272416). Record: `docs/release-pr21.md` |
| 14 | Rollback candidates retained | Verified | `dd29ca1` deployments: API `dpl_EF3sA2hLu3t4XenobFqUWQDsDb9f`, web `dpl_JD731LPMjNcYqhM6egAYsj28LsZU` |
| 15 | PR #21 temporary infrastructure clean-up | In progress | Neon branch `pr21-start-auth-isolated` deleted by the owner (2026-11-08). Remaining: branch `claude/pr21-prod-smoke`, GitHub environment `pr21-isolated`, three Vercel variables on `claude/start-auth-routing`, and review of the PR #20 production-branch exception. RC-1 variables stay unchanged |
| 16 | Customer-workflow acceptance in production (RC-1 review requirement) | Verified | Run 42464039694 against `667eec1`: 108 passed, 0 test failures, 0 clean-up failures; 4 synthetic accounts and workspaces deleted and refused sign-in. Artifact 13611066471. Record: `docs/phase1-production-acceptance.md` |
| 17 | Agent Studio (PR #2) scope | Provisional: Phase 2 | Unmerged; targets an old branch. Classified as Phase 2 pending the owner's master roadmap |

## Phase 2: voice foundation and VOXERA Global

Updated 2026-11-08. Production at `0b04695`. Items 18–19 are in production; items 20 onwards are on
development branches with CI evidence and need owner approval before any migration, merge or paid
run. All voice results are **simulated** (stand-in providers); none is a real-call measurement.

| # | Item | Status | Evidence / blocker |
|---|------|--------|--------------------|
| 18 | Prompt caching, shared connections, turn metrics (PR #25) | Verified (production) | Merge `cb72269`; preflight passed, `/healthz` `cb72269`, `/readyz` 200 |
| 19 | Scripted-call harness, ADR-0005 (PR #26) | Verified (production) | Merge `0b04695`; API `dpl_ERMVK1m3fPoAbXuPA6TcU6v22o3d` READY; preflight at 0009 |
| 20 | Shared Postgres rate limiter, migration 0010 (PR #27) | Branch, CI green | 19 tests; local clone rehearsal 350/0. **Blocked:** migration approval; preview refused by schema gate (expected) |
| 21 | Call records and simulated calls, migration 0011 (PR #28) | Branch, CI green | 25 tests; harness records every scenario. **Blocked:** migration approval |
| 22 | Dedicated validation databases for #27/#28 | Prepared, read-only verified | Neon `br-divine-poetry-zaxsxbs0` (→0011), `br-red-cherry-zaxx9s1o` (→0010), both claim `staging` at 0009. **Blocked:** migration and six branch-scoped Vercel variables need approval (`docs/phase-2-validation-environment.md`) |
| 23 | ADR-0006 VOXERA Global; implementation inventory | Proposed | `docs/decisions/ADR-0006-voxera-global.md`, `docs/phase-2-global-inventory.md` |
| 24 | Language registry, evidence levels, policy routing, language state | Branch `claude/phase2-global` | 25 tests incl. data-residency never relaxed by fallback; nothing marked `tested` |
| 25 | Languages API, route preview, per-turn language in the brain | Branch `claude/phase2-global` | Cached prefix byte-identical with a language set (test) |
| 26 | Voice-worker prototype (LiveKit Agents adapter) | Branch `claude/phase2-global` | 13 session tests; adapter run against livekit-agents 1.8.11; stand-in call through the real API (3 turns, switch to Hindi, context kept). **Blocked for hosting:** LiveKit and worker hosting approval |
| 27 | Multilingual harness (hi, ml, ar, switching, Hinglish) | Branch `claude/phase2-global` | 12/12 stand-in scenarios (plumbing only) |
| 28 | Real-model, real-audio and telephony validation (Sprint E) | Not run | Needs paid keys with caps, hosting and a test number: owner approval |

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
| F1 | Production environment mode and invitation-token exposure | Corrected 2026-11-07. The original claim ("no `VOXERA_ENV` in production") came from Vercel's list endpoint, which omits `visibility: config` variables; direct lookup shows `VOXERA_ENV` (ID `yul7m6An1XBpgCwC`) existed since 2026-11-02, prior value unknown. Now verified by ID: `VOXERA_ENV=production` (Production only); `VOXERA_EXPOSE_INVITE_TOKENS=true` (ID `SCp6kN2A6t12C4pa`, Production only) | Invitation email is not implemented (Phase 8); the Team page builds invite links from the returned token, so `false` would disable invitations | Keep tokens exposed until email invitations ship, then set `false` and test end to end. Both settings take effect at the next production deployment; do not redeploy live `767c0f2` (its build migrates and resets the runtime role). Verify `/docs` 404 and HSTS during promotion. Rehearsed on RC-1: run 42345495531 green |
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
