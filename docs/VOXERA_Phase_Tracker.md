# VOXERA Phase Tracker

Status legend: **Verified** (evidence linked) · **Blocked** (named blocker) · **Not run**.
Assumptions are listed separately from verified results.

## Phase 0/1: RC-1 isolated Preview validation

Updated 2026-11-06. Validation branch `codex/rc1-validation` (PR #9, merge `9a9be1c`).

| # | Item | Status | Evidence / blocker |
|---|------|--------|--------------------|
| 1 | Restricted-runtime RC-1 profile merged to validation branch | Verified | PR #9, merge `9a9be1c`; RC-1 unit suite green |
| 2 | Branch-only profile vars (`VOXERA_DEPLOYMENT_PROFILE`, `VOXERA_EXPECT_DB_ENV`) | Verified | Vercel voxera-api, Preview, gitBranch `codex/rc1-validation` |
| 3 | All 20 `LEGACY_KEYS` masked by branch-scoped empty plain overrides | Verified (config) | Env listing shows `value: ""` for every key; shared Preview/Production untouched |
| 4 | Masking takes effect in a hosted build | Blocked | Build log could not name the refusing gate; fixed by PR #10 (awaiting owner merge) |
| 5 | Branch-only secrets `VOXERA_DATABASE_URL`, `VOXERA_BUILD_DATABASE_URL`, `VOXERA_JWT_SECRET` | Blocked | Owner action: Sensitive, Preview, branch `codex/rc1-validation`; values never via chat |
| 6 | Build preflight against dedicated DB (role `voxera_app`, `neondb`, marker `staging`, schema `0007`) | Not run | Depends on 4–5 |
| 7 | Frontend (voxera-flow) Preview bound to the RC-1 API | Not run | Depends on 6 |
| 8 | Hosted synthetic acceptance | Not run | See `docs/rc1-hosted-acceptance-matrix.md` |
| 9 | Production isolation | Verified (unchanged) | No production deploy, claim, migration or setting change in this phase |

Preview deployments retained as evidence: `dpl_zyAZ3dYfWjsx3v9hFqPdi8ZuunVJ` (commit
`9a9be1c`, refused at preflight with the generic message, no database writes possible:
read-only transaction).

## Assumptions (not verified here)

- Dedicated Neon project `voxera-rc1-validation` is at identity `staging`, schema `0007`,
  with `voxera_app` non-superuser, no BYPASSRLS (per `docs/rc1-preview-runtime.md`,
  verified by the previous operator; this session has no Neon access and will re-verify
  through the build preflight).
- Vercel applies an empty branch-scoped value in place of the shared Preview value
  (vendor-documented precedence; item 4 proves it empirically).
