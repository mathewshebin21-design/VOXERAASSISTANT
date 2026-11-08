# Release record: PR #21 (authenticated design navigation, no silent demo data)

Status: **released and verified in production on 2026-11-08.** No rollback was needed.

This is the permanent record of the release. Everything below can be checked independently from the
GitHub and Vercel IDs given.

## What was released

[PR #21](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/21) fixed a production report:
the design chooser said "Sign in first" while another page looked signed in. It changed the
following:

- **Sign-in states.** A failed workspace list is recorded as `orgsError` and is never treated as
  being signed out. The chooser distinguishes three states: signed out, workspace list failed (with
  Try again), and no workspace.
- **Safe return after sign-in.** `/start?next=` accepts only same-site app pages (`safeNext`
  allowlist, 18 unit tests).
- **No silent demo data.** When a signed-in user's workspace list fails, Command, Atelier and Flow
  show "Your workspace couldn't be loaded" instead of demo data. Demo data opens only when chosen,
  and it is labelled. The Flow header shows the real workspace name instead of the demo business.
- **Stricter test harnesses.** In the three browser suites, a check that returns a failure message
  now fails instead of passing.
- **Branch hosted acceptance.** An isolation gate plus the design-selection suite against a feature
  branch's own previews.

No API code and no database schema changed. Production was already at schema 0009 from PR #20.

## Identifiers

| Item | Value |
|---|---|
| Merge commit | `931138e62d5770432da1a64cc7b4d1c1cf1b339a`, merged 2026-11-08 07:40:09 UTC |
| Merge parents | `dd29ca1` (previous production, the PR #20 merge) and `b80df81` (PR #21 head) |
| Production branch | `claude/confident-shannon-7nb05f` |
| Production API | `dpl_8gt2Pfqf9dbuLM58RQSDPY3U8GkE`, READY 07:41:51 UTC, `https://voxera-api-two.vercel.app` |
| Production web | `dpl_FZYuDuaSjXK35Z4pNnBcEpPQDUyR`, READY 07:41:14 UTC, `https://voxera-flow.vercel.app` |
| Rollback candidates (`dd29ca1`) | API `dpl_EF3sA2hLu3t4XenobFqUWQDsDb9f`, web `dpl_JD731LPMjNcYqhM6egAYsj28LsZU`; both READY and listed as rollback candidates after the release |
| Database | production Neon database, marker `production`, schema `0009`. No migration was run |

## Production release gates

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Merge commit and both production deployments | Pass | The merge contains the 20 PR files and nothing under `services/api`. Both builds cloned `claude/confident-shannon-7nb05f` at `931138e`, are READY, and hold the production domains |
| 2 | `/healthz` identifies the deployed commit | Pass | `{"status":"ok","commit":"931138e"}` |
| 3 | `/readyz` returns 200 | Pass | `{"status":"ready"}` |
| 4 | Production database identity and schema | Pass | API build log: `vercel_build: database preflight passed (production, schema at 0009).` The preflight is read-only |
| 5 | Authentication and design smoke test | Pass, 13/13 | GitHub Actions [run 42459985605](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/42459985605), job 128667006526 |
| 6 | Previous deployments available for rollback | Pass | See rollback candidates above |

### Production smoke test (gate 5)

The owner authorised one temporary probe account and workspace for this test. It ran from the
one-off workflow `pr21-prod-smoke.yml` on the branch `claude/pr21-prod-smoke`, never on the
production branch, because the agent's sandbox cannot reach `vercel.app`. Before touching
production, the same script was dry-run against a local stack: 13/13, and the database held no
probe user or workspace afterwards.

1. API `/healthz` serves the merge commit.
2. API `/readyz` returns 200.
3. The web app serves `/` and `/start`.
4. Sign-up through the production web app creates the probe account and workspace.
5. A wrong password is refused (401).
6. Sign-in at the production API succeeds, and `/me` is the probe.
7. The probe sees exactly its own workspace, as owner.
8. Design endpoints: read, choose Flow for the probe, and the choice persists.
9. Signed out, the chooser says so and offers sign-in back to it.
10. Signing in on `/start` opens Flow with the real workspace name, with no workspace error and no
    signed-out state on the chooser.
11. **Clean-up:** the account and its workspace are deleted (204). The account was the workspace's
    only member, so the API deleted the workspace with it and recorded a deletion receipt for each.
12. **Clean-up proof:** the probe can no longer sign in (401).
13. **Clean-up proof:** the probe's old session no longer reaches the workspace (401).

The probe existed from 07:44:55 to 07:45:03 UTC. The production database was not queried directly
(no production credentials were used). Clean-up is proven through the API.

## Pre-release validation (PR head `b80df81`)

| Check | Result | Evidence |
|---|---|---|
| Isolated database | Neon branch `pr21-start-auth-isolated`, created from staging main, migrated 0008 → 0009 only: 51/51 baseline, 86/86 verify, nothing pending | Run 42452577655 |
| Branch hosted acceptance | Isolation gate → **28/28** browser checks → gate again. The probe and all test accounts were deleted | Run 42458272416 |
| Branch previews | API `dpl_3Y2THYWdHnGYbHJfy55jRhfxiRWN`, web `dpl_9xvnQ8Gat4cyNyn16maeG2HPtp2w` | Vercel |
| `integration` (live, designs-live and design-select suites against a real API and Postgres) | Pass | Runs 42458272472 (push), 42458275147 (PR) |
| `previews` (lint, typecheck, unit tests, build, demo browser suite) | Pass | Runs 42458272429 (push), 42458275339 (PR) |
| Local | design-select 28/28, live 28/28, designs-live 14/14, demo suite 131/131, vitest 256, script tests 54, lint and typecheck clean | Session record |

The isolation gate proved that the branch database was separate: an account created through the
branch web app signed in at the branch API and was refused (401) by both shared staging and
production.

## Release conditions set by the owner

| Condition | Evidence |
|---|---|
| A workspace-list failure must not be treated as an unauthenticated session | A forced 503 shows the workspace error, never the signed-out state, and Try again recovers (hosted) |
| The return URL must reject external destinations and unsafe redirects | `safeNext` unit tests; `?next=https://evil.example/` is ignored (hosted) |
| No silent demo data when the workspace fails to load | For each design, a 503 shows the error with no demo data and recovers. Demo data opens only when chosen, and it is labelled (hosted) |
| Command, Atelier and Flow selections persist | Each opens again after a reload and after signing in from a fresh browser (hosted); Flow also verified in production (gate 5) |

## Remaining risks and follow-ups

| Item | Risk | Follow-up |
|---|---|---|
| One-off PR #21 files on the production branch: `.github/workflows/pr21-isolated-db.yml`, `.github/rehearsal/pr21-db.request`, and `claude/start-auth-routing` in `branch-hosted-acceptance.yml` | None while inert: they trigger only on pushes to `claude/start-auth-routing` | Remove in the next normal development PR, not in a deploy of their own |
| Login rate limiter is in-process memory (F2 in the phase tracker) | Throttling could weaken across many serverless instances | Unchanged by this release; consider a database-backed limiter |
| Signed-in user with no workspace (and no error) still sees demo data | Low: that user has no real data to confuse it with | Consider an explicit "create a workspace" state |
| Actions log retention | The smoke and acceptance logs expire after the repository's retention period (90 days by default) | This document is the permanent record |

## Infrastructure clean-up record

Dependency review on 2026-11-08 (read-only). Each deletion needs separate owner approval.

| Resource | Depends on it | Status |
|---|---|---|
| Git branch `claude/pr21-prod-smoke` (holds the one-off smoke workflow) | Nothing. Its Actions runs remain after branch deletion | Pending approval |
| Vercel voxera-api Preview vars on `claude/start-auth-routing`: `DATABASE_URL` (`u6FpzQW2Vqr1vp91`), `DATABASE_URL_UNPOOLED` (`lIAa3IBYkM1yO8Jd`) | Only that branch's previews | Pending approval |
| Vercel voxera-flow Preview var on `claude/start-auth-routing`: `VOXERA_API_URL` (`gxxWisjr9SwH5M3l`) | Only that branch's previews | Pending approval |
| Neon branch `pr21-start-auth-isolated` | Only the vars above. Production and staging do not reference it | Pending approval; owner action (no agent tool for Neon) |
| GitHub environment `pr21-isolated` | Only `pr21-isolated-db.yml`, which is inert | Pending approval; owner action |
| RC-1 variables on `codex/rc1-validation` | RC-1 | **Keep unchanged** |
| PR #20 Development-target `VOXERA_DATABASE_URL` / `VOXERA_BUILD_DATABASE_URL` | — | Already absent on 2026-11-08 (no Development-only `VOXERA_*` variable remains) |
| Temporary production-branch exception (GitHub environment deployment rule, from PR #20) | — | Owner to review separately |

## Rollback

| Situation | Action | Data impact |
|---|---|---|
| Problem in the released UI | Instant Rollback both projects to the candidates above (`dd29ca1`). Requires owner approval | None: no schema change in this release |
| Schema | Not applicable: no migration was run | — |
