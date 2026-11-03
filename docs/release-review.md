# Formal release review: RC-1 (PR #1) and RC-2 (PR #2)

Review date 2026-11-03. Reviewer: Claude Code (engineering review; read-only).
Decision authority: the owner. This record recommends; it authorises nothing.

| Release | Change | Commit | Target | Schema |
|---|---|---|---|---|
| RC-1 | PR #1: environment isolation, explicit migrations, read-only build, AI path hardening, setup assistant | `a7ba2f0` | production branch `claude/confident-shannon-7nb05f` (`767c0f2`) | 0006 → **0007** (claim) |
| RC-2 | PR #2: Agent Studio (flows, engine, Testing Lab, plain-English edits, insights) | code `359aa31`; PR head `20b5ed9` (only `docs/` changed after `359aa31`) | production branch after RC-1 | 0007 → **0008** |

## 1. Recommendation
- **RC-1: GO on engineering. Not executable until the four prerequisites in §4 are met.**
- **RC-2: GO on engineering, after RC-1 has been validated in production.** It uses the reordered sequence (merge, then migrate, then redeploy; `docs/production-release-plan.md` §6–7). Finding R2-M1 (incomplete data export) is accepted for this release only because no real caller data exists yet (no telephony). It must be fixed before real calls or the next customer-data feature.
- **Overall production status: NO-GO today.** It's waiting on owner prerequisites, not on engineering.
- The product **isn't production-ready** in the launch sense. No real AI, voice or phone provider has been tested, and there has been no independent security review or operational validation (load, monitoring, on-call). This release moves validated foundations and the Agent Studio to production; it isn't a launch.

## 2. Evidence
| Evidence | Result |
|---|---|
| PR #1 GitHub CI at `a7ba2f0` | 7/7 green (the Vercel API preview status is red by design: it needs 0007, and staging is at 0008) |
| PR #2 GitHub CI at `359aa31` | `test`, `live-e2e`, `check`, Vercel ×2: all green |
| PR #2 GitHub CI at `20b5ed9` (current head, docs-only change) | `test` ✅, `check` ✅, Vercel ×2 ✅. `live-e2e` ✅ on re-run: the first attempt failed in `next build` while downloading Google Fonts (`next/font` loader), before any test ran, so it was a runner network failure, not the app |
| Merge simulation | PR #1 → production: clean. PR #2 → production: clean |
| Release-path rehearsal, disposable production copy (0006 + customer data) | **51/51**: refusals before the claim, read-only check, wrong host refused, claim → 0007 with data kept, each commit's build gate, 0008 upgrade, Agent Studio and Testing Lab on 0008, the rollback code on 0008, downgrade and re-upgrade, staging migrator refused |
| Compatibility harness | **40/40** (`767c0f2` can't be rebuilt, so Instant Rollback only) |
| Staging verification (run #1) | migrate ✅, isolation ✅, staging browser tests 14/14, demo designs 131/131 |
| Phase 0 gates 0.1–0.8 | all PASS (`docs/phase-0-closure-report.md`) |
| Production health | `dpl_EEBq…` at `767c0f2`, READY, 0 runtime errors in 24 h |
| Code reviews | PR #1: `docs/pr1-review.md`. PR #2: §3 below |

## 3. PR #2 code review (`a7ba2f0..359aa31`, 39 files, +5986 / −28)
**Verdict: approve. No high-severity findings.**

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| R2-M1 | Medium (privacy) | **The workspace data export (`GET /v1/orgs/{id}/export`) leaves out the Agent Studio tables:** `agent_flows`, `agent_flow_versions`, `flow_sessions` (simulated transcripts, which can contain names and phone numbers typed in) and `flow_tests`. *Pre-existing, same gap:* `case_notes` and `desk_agents` (from 0005) are also missing. The tracker's "Data export ✅" therefore overstates the coverage. Workspace deletion **is** complete: every table cascades from `organizations`. | Add the six tables to the export, with a test that fails whenever a table with `organization_id` is missing from it. Small and code-only. **Fix before real calls**; it doesn't block RC-2 while all `flow_sessions` are staff simulations. Correct the tracker row. |
| R2-L1 | Low | A **read-only** member (viewer) can start simulated conversations and run the Testing Lab. This writes `flow_sessions` rows, and the first open writes the `agent_flows` row, with no rate limit. There's no data exposure or real booking: sessions are always `mode="simulation"` and validated inside a rolled-back savepoint. | Optionally require `agent_write` for sessions and test runs, or add a per-workspace limit. |
| R2-L2 | Low | The foreign keys `agent_flows.agent_id` and `flow_sessions.agent_id` aren't tied to `organization_id`. A foreign-key check bypasses row-level security, so isolation relies on the router's `_agent()` lookup, which every route uses (checked: each route resolves the agent with `organization_id == ctx.org_id` first). | Defence in depth: composite `(organization_id, agent_id)` keys in a later migration. Not needed for this release. |
| R2-L3 | Low | A simulated booking takes the per-workspace booking lock until the request ends. It's short, but a long simulation turn briefly delays real bookings in the same workspace. | Acceptable at current scale. |

**What checked out as sound:**
- **Migration 0008** is purely additive: 4 tables, each with row-level security and a WITH CHECK clause. **Published versions are immutable** for the app role (`SELECT, INSERT` only). The downgrade drops only the new tables.
- **Every route** has a permission dependency: `read` for viewing and simulating, `agent_write` for the draft, publish, rollback, restore, tests and change proposals. Every route resolves the agent, flow, session and test within the caller's workspace.
- **Publishing** checks `base_revision`, so stale drafts can't be published. It runs the Testing Lab, and **is refused when any test fails**. Model-graded checks are skipped, not passed.
- **The engine** is deterministic, calls no language model, and uses `reception.py`. Simulations validate real availability inside a savepoint and save nothing.
- **Input is bounded:** ≤ 200 nodes, ≤ 400 edges, text capped at 600 characters.
- **Shared-code change** (`reception.pick_available_agent` / `hand_off`): an optional `roles` filter whose default keeps today's behaviour.
- **Frontend:** no `dangerouslySetInnerHTML`, `eval` or public keys. All data goes through the same-origin API proxy.
- **CI scripts:** `wait-for-deploy` now needs the full commit from both identity endpoints and rejects placeholder pages (19 tests).

## 4. Go/no-go criteria
| # | Criterion | RC-1 | RC-2 |
|---|---|---|---|
| 1 | CI green on the exact commit to merge | ✅ | ✅ |
| 2 | Code review approved, no open high findings | ✅ (M1 fixed in the plan; M2 → criterion 5) | ✅ (R2-M1 accepted with a deadline) |
| 3 | Migrations rehearsed on a production copy, data kept, rollback proven | ✅ 51/51 | ✅ 51/51 |
| 4 | **Owner approval on the PR (GitHub review)** | ❌ | ❌ |
| 5 | **GitHub `production` environment:** secret, required reviewer, default-branch-only | ✅ configured (owner screenshots plus a GitHub API read of the settings, 2026-11-03; admin bypass off). First real run still to prove the approval prompt (SF-1) | same |
| 6 | **Fresh Neon backup branch and snapshot, T0 recorded** (`docs/production-release-runbook.md` §2a) | ❌ (taken just before the claim) | ✅ if within the same session; otherwise a new one before the 0008 upgrade |
| 7 | Rollback target identified and tested | ✅ `dpl_EEBq…`, Instant Rollback only | ✅ RC-1's deployment |
| 8 | Quiet window agreed, validation checklist ready | ❌ owner to choose / ✅ runbook §3 | same |
| 9 | Previous release validated in production | n/a | ❌ needs RC-1 first |

## 5. Risks
| Risk | Status | Owner decision needed |
|---|---|---|
| Historical production credentials valid until rotation | Open. Rotation possible only after RC-1 is live | Approve RC-3 (rotation) after RC-2 |
| Preview Deployment Protection **confirmed off** on both projects (SF-5) | Open | Enable or accept |
| Neon Free: 6-hour instant restore and 1 snapshot | Open. Mitigated by a backup branch taken just before | Accept, or upgrade the plan (a cost: separate approval) |
| JWT secret derived from the database password | Open. Safe transition in runbook §5 | Approve setting `VOXERA_JWT_SECRET` before the RC-1 redeploy |
| `767c0f2` can't be rebuilt | Mitigated (Instant Rollback to `dpl_EEBq…` only) | — |
| Data export incomplete (R2-M1) | Open; fix before real calls | Accept for RC-2 |

Findings are tracked in the tracker's open security findings register (SF-1 to SF-6); none is resolved.

## 6. Sign-off (owner)
| Release | Decision | Date | Conditions |
|---|---|---|---|
| RC-1 | ☐ Approve ☐ Reject | | |
| RC-2 | ☐ Approve ☐ Reject | | |
