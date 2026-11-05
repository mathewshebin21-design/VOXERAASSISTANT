# VOXERA AI — Project tracker

This is the single place for project status. Two sources feed it:
- **The plan** is the master specification written in ChatGPT. That document isn't in this repository, so the phases below (0–11) come from the agreed vision list and are provisional. Replace them with the specification's 11 phase titles once it is shared.
- **What is actually done** comes only from this repository and checked deployment evidence. Nothing is marked done just because it is documented.

Last updated: 2026-11-03 (branch `claude/agent-studio`; this update is local, not pushed). Release review documents: `docs/release-review.md`, `docs/pr1-review.md`, `docs/production-release-runbook.md`; plan correction M1 in `docs/production-release-plan.md`.

> **Phase numbering:** you describe the roadmap as Phases 0–10 (11 phases). The provisional grouping below has 0–11 (12). It will be renumbered to match once the master specification's phase titles are shared; until then, no phase is renamed or merged on a guess.

## Status key
| Mark | Meaning |
|---|---|
| ✅ Verified | Code exists, automated tests pass, and (where relevant) it's checked in a real browser or deployment. |
| 🧪 Built, not deployed | Code and tests exist on a branch, but it isn't merged or live. |
| 🟡 Partial | Some of the requirement exists. The gap is listed. |
| 🎭 Demo only | The UI exists but uses sample data and isn't wired to the real backend. |
| ❌ Not started | |
| 💷 Needs paid service | Blocked on a provider that costs money. Needs your approval. |

## Evidence: last verified runs
| Check | Result | Where |
|---|---|---|
| API test suite (pytest, real Postgres) | 205 passed, 0 failed | local, `claude/agent-studio` at 3dbae82 |
| API lint and format (ruff) | clean | local |
| Migration round-trip (up → base → up, 0001–0008) | OK | local Postgres 16 |
| Web unit tests (vitest) | 237 passed | local |
| Web typecheck, lint, production build | clean | local |
| Browser e2e, previews (`e2e.mjs`) | 131/131 | local, real Chromium |
| Browser e2e, live API (`e2e-live.mjs`, fake providers) | 26/26 | local |
| Browser e2e, three designs against the live API | 14/14 | local |
| Browser e2e, Agent Studio | 14/14 | local |
| Staging isolation checker tests | 9/9 | local |
| GitHub CI on PR #1 | green, all 7 checks | GitHub, head a7ba2f0 |
| GitHub CI on PR #2 at 273e5f5 | `test` ✅, `live-e2e` ✅ ×2 (live 26/26, designs 14/14, Agent Studio 16/16), `check` ×2 ✅: **all 6 checks green** | GitHub |
| PR #2 previews at 273e5f5 | voxera-api: refused to deploy ("missing database configuration"), as intended. voxera-flow: ready; its preview settings point only at the staging API | Vercel |
| GitHub CI on PR #2 (earlier heads) | 0318d01: all green after one re-run. 6e32b6d (tracker only, same code): `live-e2e` ❌ (Agent Studio 12/14, the intermittent bug below), `test` and `check` ✅ | GitHub |
| Agent Studio intermittent failure | **Fixed and pushed** (e0a9dcc test reliability, 273e5f5 app fixes, PR #2). Locally: 7/10 runs passed before the fixes, 20/20 after, then 5/5 with 2 regression checks. CI on 273e5f5: Agent Studio **16/16** in both `live-e2e` runs | local Chromium, GitHub CI |
| voxera-api preview with no staging database | fails closed: "REFUSING TO DEPLOY: missing database configuration." | Vercel builds of a7ba2f0 and 0318d01 |
| Production deployment | commit 767c0f2 live | https://voxera-api-two.vercel.app, https://voxera-flow.vercel.app |
| **Staging verification (run #1)** | ✅ **passed**: migrate ✅, readiness ✅, isolation ✅, staging browser tests 14/14 ✅, demo designs 131/131 ✅ | GitHub Actions run 41502348420 (attempt 2), staging at 94dae66 |
| Real phone calls, real AI provider, real voice | **never tested** | — |

## Phase 0 closure status: ✅ **COMPLETE for engineering and staging readiness** (2026-11-03; see `docs/phase-0-closure-report.md`). Production release is tracked separately.
| Gate | Status |
|---|---|
| 0.1 Preview can't read production | PASS (historical previews deleted 2026-11-03; verified) |
| 0.2 Preview can't write production | PASS (historical previews deleted 2026-11-03; verified) |
| 0.3 Staging migrator refuses production | PASS |
| 0.4 Production migrator refuses staging | PASS |
| 0.5 No production credentials in Preview/Development | PASS (historical previews deleted 2026-11-03; verified) |
| 0.6 Wrong identity fails closed | PASS |
| 0.7 Hosted tests on staging only | PASS |
| 0.8 Production unaffected | PASS |

- **Evidence:** 78/78 negative and compatibility checks on disposable databases; PR #2 CI 6/6 at `41a4a13`; staging run 41502348420 green.
- **To close:** delete the 16 historical previews (owner approval). Confirm Deployment Protection. Rotate voxera-db's password after PR #1 is live.

### Phase 0 final cleanup (2026-11-02, owner approval "PHASE 0 FINAL CLEANUP")
- **Docs pushed:** `23ec727` and `cf1ab39` (docs only, no secrets). PR #2 head `cf1ab39`. No GitHub workflow triggered (path filters). Last code CI: 6/6 green at `41a4a13`.
- **Deletion: DONE by the owner, 2026-11-03.** Verified read-only: all 16 removed (404); production and staging unchanged; no production credentials in Preview or Development. Deleted:

| Project | Deployment | Commit (branch `claude/stoic-davinci-vvk3jg`) | Alias |
|---|---|---|---|
| voxera-api | dpl_D8WTbbLe4LqUfqRKVoyZGZTAqPjG | b1adb59 | none |
| voxera-api | dpl_AzTGn3nnrj3AoH8YDYLEZsLRHcRW | 1b6ed70 | none |
| voxera-api | dpl_9MLFzZf5wZtbR8sV4sPKUWNZ49mv | d65747d | none |
| voxera-api | dpl_F7mWRfmRG5SdoLH6aMrVrujzz6Zh | 4ded6ff | none |
| voxera-api | dpl_mfq3svRtZSmyKxZs31cdXXbgchp8 | eb9d7ee | none |
| voxera-api | dpl_BPQTF7o1F7BcjD1SBhZGVGqYqhZW | 9963feb | none |
| voxera-api | dpl_3mGpaVh2vbPRPc4jEmSDcPXDWoGb | 0588709 | none (applied 0006 to production) |
| voxera-api | dpl_CMEqkvv1RyR7CiRUVAU9niv7u7q2 | 469283d | `voxera-api-git-claude-stoic-davinci-vvk3jg-ai-e399.vercel.app` (PR #1 branch link, not used by staging or production) |
| voxera-flow | dpl_Bt2eVKNvnc8mCmTsxZ5VsxxkMF7c | b1adb59 | none |
| voxera-flow | dpl_EDhZsdU6bvp5dkaj66SxYyqrN7JE | 1b6ed70 | none |
| voxera-flow | dpl_HRJEVfchu4ZiA5JP1yn8mtRD1BZb | d65747d | none |
| voxera-flow | dpl_qMbgjcs6MeLDRziiUPLvyjXSAkmu | 4ded6ff | none |
| voxera-flow | dpl_9p7YpryTvMu6owbU7wjp3JDM9aEu | eb9d7ee | none |
| voxera-flow | dpl_36fDwZ27PFksMF7SBiGtmDC6mUEE | 9963feb | none |
| voxera-flow | dpl_1RFR5XKJmfwtQK9RnnPYN3RRXAaN | 0588709 | none |
| voxera-flow | dpl_57Gd5RLRQQ5Uft6MiKNv6GemUs5Z | 469283d | none |

- **Not in the list (must stay):**
  - production: voxera-api `dpl_EEBqGurCwGj7mWkhzWNGQSo4JWiA`, voxera-flow `dpl_9HL5T88ctcVAPYQqHiHf9Dj1DzSm` (767c0f2), plus older production rollback candidates;
  - staging: `dpl_CEjtPzeC6MzYNv3zLZyF38KqMC3y` and `dpl_6LddL7Zny7eZSNGyRjMAHAhpWxN2` (94dae66);
  - PR #2 previews;
  - all previews built after the switch to staging.
- **Deployment Protection:** **confirmed off** on voxera-api and voxera-flow (Vercel project settings, read-only, 2026-11-03: Vercel Authentication, password protection and trusted IPs all disabled). Tracked as SF-5.
- **Open production-release risks (owner decision 2026-11-03; kept open until each is resolved):**
  1. Historical production credentials may stay valid until voxera-db's password is rotated (release plan step 8, after PR #1 is live).
  2. Preview Deployment Protection is not enabled (confirmed off 2026-11-03).
  3. Production migration compatibility, backup and recovery each need release-specific approval (`docs/production-release-plan.md`).
- **Open security findings register (none may be marked resolved without evidence; owner decision 2026-11-03):**
  | # | Finding | Severity | Status | Closes when |
  |---|---|---|---|---|
  | SF-1 | PR #1 M2: `db-migrate.yml` doesn't restrict which branch it runs from | Medium | **Mitigated, pending first-run proof.** ① Environment settings confirmed 2026-11-03: owner screenshots, plus a read of the settings through the GitHub API (names and settings only) from a separate session. `Production` exists (GitHub environment names are case-insensitive); required reviewer `mathewshebin21-design`; **admin bypass off** (`can_admins_bypass: false`); exactly one deployment branch rule, `claude/confident-shannon-7nb05f`; environment secret `DATABASE_URL_UNPOOLED` present (added 07:25 UTC); no repository-level copy (only `STAGING_DATABASE_URL_UNPOOLED`). ② Workflow guard pushed in `037e25f` (repository + manual trigger + exact ref; 62 tests), CI green at `bc033d3` | The first real `db-migrate` production run after PR #1 merges stops at GitHub's "Review deployments → Approve" step |
  | SF-2 | PR #2 R2-M1: the workspace data export omits `agent_flows`, `agent_flow_versions`, `flow_sessions`, `flow_tests`, `case_notes`, `desk_agents` | Medium | Open. **Required fix before processing real customer conversations** | The export covers every table with `organization_id`, enforced by a test |
  | SF-3 | No independent `VOXERA_JWT_SECRET`: signing is derived from the database password | Low–Medium | Open. Confirmed absent (Vercel variable names, 2026-11-03) | Set for Production and verified (runbook §5) |
  | SF-4 | Historical production credentials (copied from the deleted previews) still valid | Medium | Open. Rotation possible only after RC-1 is live | voxera-db password rotated, GitHub secret updated, role reset, redeployed (release plan step 8) |
  | SF-5 | Preview Deployment Protection | Medium | Open. **Confirmed off** on voxera-api and voxera-flow (Vercel project settings, 2026-11-03) | Enabled, or risk formally accepted by the owner |
  | SF-6 | The demo Integrations pages (Command, Flow) say secrets are in a "server-side vault, per tenant". No vault exists | Low (honesty) | Open | Text changed to "planned" or the vault exists |
- **Residual risks (tracked, not blocking Phase 0):**
  - credentials copied from the deleted previews stay valid until voxera-db's password is rotated (release plan step 8, after PR #1 is live). **Medium.**
  - Preview Deployment Protection appears off. **Medium**; optional owner setting.

## Phase 0 log: staging run #1 (2026-11-02, approved "approve staging run")
- **Branch:** `staging` created at `94dae660d50fc356a53a48f43e2fcd63807e2377` (PR #2's head).
- **migrate** (18:37–18:38 UTC):
  - secret present;
  - target host `ep-raspy-brook-za7ptsba.c-2.eu-west-2.aws.neon.tech`, database `neondb`;
  - ran 0001→0008, then "database claimed for staging";
  - check: "claimed for: staging; schema at 0008; code head 0008; pending migrations: none".
  - Ran once only; the verify re-run reused it.
- **Deployments:** Vercel did not build the new branch on its own (the commit had already been deployed for `claude/agent-studio`). Both `staging` previews were created by hand, preview target only:
  - API `dpl_CEjtPzeC6MzYNv3zLZyF38KqMC3y`: "database preflight passed (staging, schema at 0008)", READY;
  - web `dpl_6LddL7Zny7eZSNGyRjMAHAhpWxN2`: READY.
- **verify, attempt 1:** failed. The readiness step accepted Vercel's "Deployment is building" page (HTML, HTTP 200), and the isolation script crashed parsing it. No test ran against an unverified deployment.
  - Fixed locally in commit 1d40bf6 (not pushed, waiting for review).
- **verify, attempt 2:** ✅
  - readiness: API serving 94dae66, readyz 200, web 200;
  - isolation: "Verified staging database marker, web upstream and both deployment commits";
  - staging browser tests (`e2e-designs-live`): 14/14;
  - demo designs (`e2e`): 131/131.
- **Production:** not accessed or changed. No production deployment and no production setting change. voxera-db is still Production-only on voxera-api.

## Phase 0 log: staging database (2026-11-02)
**Step 1: current infrastructure (read-only)**
- Neon integration `icfg_Zev6kFBfjF7379jFbirExvlq` is on plan `free_v3` ("Free"): no payment method required, up to 100 projects, 1 GB and 100 CU-hours per project. A third project fits within it.
- **voxera-db** (`store_UadVJGzLK4AemwDu`, Neon project `cool-block-14364291`, lhr1, Neon Auth off) is connected only to voxera-api, Production only. All 16 integration variables plus `VOXERA_ENV` target `production`. Hidden production variables: 0.
- **neon-cobalt-flask** (`store_pHMCqUi5oDE7yLlQ`, Neon project `misty-wave-36712055`, lhr1, Neon Auth on) has 0 connected projects. Its secrets were rotated at 2026-11-02 12:18 UTC.
- **voxera-api Preview and Development**: no database variables at all.
- **voxera-flow**: no database variables. `VOXERA_API_URL` is the staging API for Preview and Development, and the production API for Production only.
- **`voxera-staging` duplicate check**: no project has variables from such a store, but these tools can't list every store. Check Vercel → Storage.

**Step 2: provisioning.** Not done. The Vercel tools here can create Blob stores only, and there's no Vercel or Neon CLI or token in this container.

**Step 3: identity.** Not available until the store exists.

**Step 4: prepared target configuration (not applied)**
| Project | Environment | Database |
|---|---|---|
| voxera-api | Production | voxera-db (unchanged) |
| voxera-api | Preview | voxera-staging |
| voxera-api | Development | voxera-staging |
| voxera-flow | Production / Preview | none (calls the API only) |

**Credential exposure found**
- 8 voxera-api preview deployments are still READY: `dpl_D8WTbbLe…`, `dpl_AzTGn3nn…`, `dpl_9MLFzZf5…`, `dpl_F7mWRfmR…`, `dpl_mfq3svRt…`, `dpl_BPQTF7o1…`, `dpl_3mGpaVh2…`, `dpl_CMEqkvv1…`.
  - They were built while Preview had the production database; the earlier 0006 migration incident confirms that connection. Their stored runtime environment therefore likely still contains production database credentials.
  - Their code has no environment guard.
  - The branch alias `voxera-api-git-claude-stoic-davinci-vvk3jg-ai-e399.vercel.app` points at the newest one.
- 8 voxera-flow previews for the same commits are READY, built while previews used the production API.
- Changing the integration does not revoke these snapshots. Deployment protection status couldn't be confirmed from this session.

**Agent Studio intermittent failure (investigated 2026-11-02)**
1. *Blank canvas.* Node objects were rebuilt without React Flow's measured sizes, so React Flow hid them (`visibility: hidden`) until it measured them again, which sometimes never happened. The CI symptom was a timed-out click on a node that is "not visible", with an empty canvas in the screenshot.
2. *Autosave stuck on "unsaved".* Every edit was saved twice, and a save slower than 900 ms left the badge on "unsaved" and Publish disabled until a reload. Reproduced deterministically with a 1.5 s save.
- Test-only commit e0a9dcc (pushed 2026-11-02, approved as "A"): full error and call log, screenshot and page text on failure (uploaded by CI), waits on the real saved state, and Publish clicked only once enabled. No retries, no weaker assertions.
- App-fix commit 273e5f5 (pushed 2026-11-02, approved as "A"): both fixes, one save per edit, and regression checks for a slow save and for a canvas still drawn after publishing.

**Historical preview deployments (inventory; nothing deleted)**
| Project | Count | Built from | Production credentials | Reachable |
|---|---|---|---|---|
| voxera-api | 8, READY | PR #1 commits b1adb59 → 469283d (Preview) | **Yes, very likely in the runtime environment**: the build logs show migrations run against the then-connected database, which was only voxera-db | Unknown. Depends on Deployment Protection, which I can't read from here. The branch alias `voxera-api-git-claude-stoic-davinci-vvk3jg…` points at the newest |
| voxera-flow | 8, READY | the same commits | No database credentials (none connected to voxera-flow then). They call the **production API** | Unknown, as above |

Safest cleanup, in this order, each needing approval:
1. Confirm Deployment Protection (Vercel Authentication) covers Preview on both projects. Reversible; immediate.
2. Delete the 8 voxera-api previews (this also frees the branch alias), then confirm production is untouched.
3. Delete the 8 voxera-flow previews.
4. Separately, plan a production database password rotation as defence in depth. The JWT secret and the app role password are derived from it, so this is a planned production change that signs users out.

**Step 5: code checks, all confirmed**
1. Builds can't change schemas: the preflight connects with `default_transaction_read_only=on`; `test_build_never_changes_the_database`.
2. Missing configuration fails closed: hosted builds refuse without a database (seen in Vercel logs); `test_invalid_hosted_identity_never_skips`.
3. Wrong identity fails closed: `deploy_env.expected()` raises on unknown or conflicting environments; the runtime guard returns 503; `test_running_api_refuses_a_database_from_another_environment`.
4. Migrations reject the wrong target: environment marker, `--confirm-host`, `--claim-if-empty` only on an empty database; `test_explicit_migrations_claim_once_and_refuse_the_wrong_environment`, `test_claim_if_empty_never_claims_an_existing_database`.
5. Concurrent runs: `pg_try_advisory_xact_lock` is held through the whole run, so a second run stops; `test_concurrent_migration_refuses_before_claim`.
6. Hosted isolation: `staging.yml` runs the identity check before any browser step that signs up. A failed step stops the job, and `/staging-identity` returns 503 unless the database is claimed for staging.
7. Full Postgres regression suite: 205 passed (isolated local Postgres 16), plus migration round-trip.

## Phases

### Phase 0: Foundations, isolation and delivery safety
| Requirement | Status | Evidence / gap |
|---|---|---|
| Monorepo: FastAPI API and Next.js web | ✅ | `services/api`, `apps/previews` |
| Multi-tenant Postgres with row-level security | ✅ | `test_tenancy.py` (RLS read, write and update across tenants) |
| Auth, roles, CSRF, rate limits, audit log | ✅ | `test_auth.py`, `test_roles.py`, `permissions.py`, `audit.py` |
| Builds never migrate; read-only preflight | 🧪 | PR #1, `test_platform.py` |
| Database environment marker; production/staging fail closed | 🧪 | migration 0007, `deploy_env.py`, runtime 503 guard |
| Explicit migration runner and workflows | 🧪 | `scripts/migrate.py`, `db-migrate.yml`, `staging.yml` |
| Production database connected to production only | ✅ | Vercel: voxera-db targets `production` only (checked 2026-11-02) |
| Unused second Neon store disconnected | ✅ | neon-cobalt-flask has no project connections |
| **Separate staging database for previews** | ✅ | `voxera-staging` (`store_bgUUGFK36oqz4kfJ`, Neon `blue-night-16595257`, Free, lhr1, Auth off) connected to voxera-api for Preview and Development only. voxera-db stays Production only. Created by the owner 2026-11-02. |
| Old previews holding production credentials | ⚠️ open risk | 8 READY voxera-api previews (PR #1 commits b1adb59…469283d) built while previews had the production database, plus 8 matching voxera-flow previews that call the production API. See Phase 0 log. |
| Staging verified end to end | ✅ | Run #1: database claimed for staging and migrated 0001→0008; API preflight passed (staging, 0008); isolation gate passed; 14/14 + 131/131 browser checks on staging |
| Deployment and rollback docs | 🧪 | `docs/deployment.md` |

### Phase 1: Core product (workspace, services, hours, staff, bookings)
| Requirement | Status | Evidence / gap |
|---|---|---|
| Workspace signup, business profile, services, hours | ✅ | API tests, e2e-live |
| Staff desk, hand-overs, least-busy routing | ✅ | `test_desk.py`, e2e |
| Availability and booking against the real diary | ✅ | `reception.py`, tests |
| Rescheduling | 🟡 | Only the AI receptionist (paid provider) can move a booking, through `reception.reschedule()`, which creates a new booking, changes the reference and can block itself. No REST endpoint, no desk action; the Agent Studio tool always fails. Spec and tests: `docs/phase-1-rescheduling-spec.md` (not implemented). |
| Data export and account deletion | 🟡 | Deletion complete (every table cascades). The export leaves out `agent_flows`, `agent_flow_versions`, `flow_sessions`, `flow_tests`, `case_notes` and `desk_agents` (finding R2-M1, `docs/release-review.md`); fix before real calls |

### Phase 2: AI receptionist and setup assistant
| Requirement | Status | Evidence / gap |
|---|---|---|
| Practice receptionist (browser) | ✅ | live in production (767c0f2) |
| Claude / OpenAI-compatible streaming, validated tool calls | 🧪 | PR #1 hardening. Tested only against fake providers. |
| Token and money caps with concurrency-safe reservations | 🧪 | migration 0006, `test_live_hardening.py` |
| Setup assistant with undo | 🧪 | PR #1 |
| A real AI provider connected in production | 💷 | Needs your approval and a spending cap |

### Phase 3: Agent Studio (Retell-style builder)
| Requirement | Status | Evidence / gap |
|---|---|---|
| Visual flow builder, 14 node types, validation | 🧪 | PR #2, e2e-studio |
| Deterministic engine with dry-run | 🧪 | `test_flow_engine.py` |
| Versions, publish gate, rollback, diff | 🧪 | `test_flows.py`, e2e-studio |
| Plain-English editing (rule-based) | 🧪 | `test_flow_instruct.py` |
| Free-form AI editing | 💷 | Needs an approved AI provider |
| Keypad, SMS, code nodes, agent-to-agent transfer | ❌ | |
| Custom HTTP functions | ❌ | |
| Per-node interruption and speed settings | ❌ | |

### Phase 4: Testing Lab and automated QA
| Requirement | Status | Evidence / gap |
|---|---|---|
| 12 standard scenarios plus custom ones; publishing blocked on failure | 🧪 | `test_flow_testing.py`, e2e-studio |
| Model-graded checks | 💷 | Skipped until an AI provider is approved |
| Voice, speech-recognition and latency testing | ❌ | Needs telephony / voice provider |

### Phase 5: Voice and telephony
| Requirement | Status | Evidence / gap |
|---|---|---|
| Browser voice lab with barge-in | ✅ | e2e-live (fake voice) |
| ElevenLabs voice | 🟡 💷 | Code path tested with fakes. Not connected. |
| Phone numbers and inbound calls | ❌ 💷 | **Don't buy numbers** without approval |
| LiveKit / Pipecat media layer | ❌ | Not evaluated yet |
| Retell / Vapi evaluation (optional) | ❌ | Not evaluated yet |
| Real human call transfer | ❌ 💷 | Logic exists; needs telephony |

### Phase 6: Call intelligence and analytics
| Requirement | Status | Evidence / gap |
|---|---|---|
| Outcomes, summaries, knowledge gaps (simulated calls) | 🧪 | `insights.py`, e2e-studio |
| Real-call analytics | ❌ | Needs telephony |
| Custom extraction fields | ❌ | |
| Live call monitoring / listen-in | ❌ 💷 | |

### Phase 7: Knowledge base
| Requirement | Status | Evidence / gap |
|---|---|---|
| Answers from workspace data, with evidence | 🧪 | engine `_answer` |
| Document and URL upload | 🎭 | The Knowledge page is a demo |

### Phase 8: Integrations (CRM, calendar, automation)
| Requirement | Status | Evidence / gap |
|---|---|---|
| Integrations pages (all three designs) | 🎭 | Sample data only |
| Google / Microsoft calendar sync | ❌ | |
| CRM (e.g. HubSpot, Salesforce) | ❌ | |
| Outbound webhooks / automation (Zapier, n8n) | ❌ | |

### Phase 9: Billing, usage and cost controls
| Requirement | Status | Evidence / gap |
|---|---|---|
| Usage page and monthly caps | 🟡 | Caps are enforced. The usage page is partly demo. |
| Subscription billing (e.g. Stripe) | ❌ | |

### Phase 10: Premium UI (three designs)
| Requirement | Status | Evidence / gap |
|---|---|---|
| Command, Atelier, Flow previews | ✅ | e2e 131/131 |
| Flow wired to the live API | ✅ / 🟡 | Core pages live; integrations, knowledge and parts of usage are demo |
| Command and Atelier wired to the live API | 🟡 | e2e-designs-live covers sign-in and core flows |

### Phase 11: Launch readiness
| Requirement | Status | Evidence / gap |
|---|---|---|
| Full CI with browser tests | ✅ | `api.yml`, `integration.yml`, `previews.yml` |
| Independent security review | ❌ | |
| Load and failover testing | ❌ | |
| Monitoring, alerting, on-call runbook | ❌ | |
| Real provider testing (AI, voice, phone) | ❌ 💷 | |
| Legal: privacy, call recording consent, terms | ❌ | |
| **Production-ready** | **No** | Not until real provider testing, security review and operational validation are done |

## Outstanding work, in order
1. **Staging database.** You create it; then I verify staging end to end (Phase 0).
2. Merge PR #1, then run production migrations 0006–0007 and claim production. Needs approval.
3. Merge PR #2, then run production migration 0008. Needs approval.
4. Evaluate telephony and media options (LiveKit / Pipecat vs Retell / Vapi). A paper comparison costs nothing; trials need approval.
5. Calendar and CRM integrations, replacing the demo Integrations pages.
6. Knowledge base uploads.
7. Webhooks, custom HTTP functions, extraction fields.
8. Billing.
9. Launch readiness: security review, load tests, monitoring, legal.

## Dependencies
| Item | Blocks | Who |
|---|---|---|
| Create Neon store `voxera-staging` (Free, lhr1, Auth off). **Approved; needs a dashboard action** | Staging verification | You (Vercel → Storage) |
| Connect `voxera-staging` to voxera-api for Preview and Development | Staging verification, safe PR previews | Your approval, then dashboard |
| Remove or protect the 16 old READY previews (8 api, 8 flow) | Closing the production credential exposure | Your decision |
| GitHub secret `STAGING_DATABASE_URL_UNPOOLED` (and optional `STAGING_API_DEPLOY_HOOK`) | `staging.yml` workflow | You (GitHub settings) |
| GitHub environment `production` with `DATABASE_URL_UNPOOLED` and required reviewers | `db-migrate.yml` for production | You |
| AI provider key and monthly cap | Real receptionist, AI editing, model-graded tests | You (💷) |
| Telephony provider and numbers | Phases 5–6 | You (💷) |
| ChatGPT master specification | Exact phase names and acceptance criteria in this tracker | You (please share it) |

## Approval gates (all still in force)
- No push, merge or deploy without your approval.
- No paid providers, phone numbers, purchases or plan upgrades without your approval.
- Preview deployments must never touch the production database.
- Unfinished features don't go to production.
- No fabricated results. Mocked integrations are labelled as mocked.
- No API keys in source code or frontend bundles.
- The product isn't called production-ready before real provider testing, security review and operational validation.

| Gate | State |
|---|---|
| Push `claude/agent-studio` (3 local commits, including this tracker) | ⏸ waiting for approval |
| Create `staging` branch and run staging workflow | ⏸ waiting on the staging database, then approval |
| Merge PR #1 + production migrations | ⏸ waiting on staging verification, then approval |
| Merge PR #2 + migration 0008 | ⏸ after PR #1, then approval |
| Any paid provider | ⏸ not requested yet |
