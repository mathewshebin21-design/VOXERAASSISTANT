# VOXERA AI — Project tracker

This is the single place for project status. Two sources feed it:
- **The plan** is the master specification written in ChatGPT. That document isn't in this repository, so the phases below (0–11) come from the agreed vision list and are provisional. Replace them with the specification's 11 phase titles once it is shared.
- **What is actually done** comes only from this repository and checked deployment evidence. Nothing is marked done just because it is documented.

Last updated: 2026-11-02 14:35 UTC (branch `claude/agent-studio`; this update is local, not pushed).

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
| GitHub CI on PR #2 | 0318d01: all green after one re-run. 6e32b6d (tracker only, same code): `live-e2e` ❌ (Agent Studio 12/14, the intermittent bug below), `test` and `check` ✅ | GitHub |
| Agent Studio intermittent failure | **2 real app bugs found and fixed locally** (app-fix commit, not pushed). Without the fixes: 7/10 local runs pass. With them: 20/20, then 5/5 with 2 new regression checks | local Chromium |
| voxera-api preview with no staging database | fails closed: "REFUSING TO DEPLOY: missing database configuration." | Vercel builds of a7ba2f0 and 0318d01 |
| Production deployment | commit 767c0f2 live | https://voxera-api-two.vercel.app, https://voxera-flow.vercel.app |
| Staging deployment | **not done**: no staging database yet | — |
| Real phone calls, real AI provider, real voice | **never tested** | — |

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
- Test-only commit "Agent Studio e2e: keep full failure details…" (local): full error and call log, screenshot and page text on failure (uploaded by CI), waits on the real saved state, and Publish clicked only once enabled. No retries, no weaker assertions.
- App-fix commit "Agent Studio: fix autosave getting stuck…" (local, awaiting approval): both fixes, one save per edit, and regression checks for a slow save and for a canvas still drawn after publishing.

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
| **Separate staging database for previews** | ❌ | Approved (Free plan, lhr1) but **not created**: the tools in this session can't create Neon stores. Needs a dashboard action (see Phase 0 log). |
| Old previews holding production credentials | ⚠️ open risk | 8 READY voxera-api previews (PR #1 commits b1adb59…469283d) built while previews had the production database, plus 8 matching voxera-flow previews that call the production API. See Phase 0 log. |
| Staging verified end to end | ❌ | Blocked on the line above |
| Deployment and rollback docs | 🧪 | `docs/deployment.md` |

### Phase 1: Core product (workspace, services, hours, staff, bookings)
| Requirement | Status | Evidence / gap |
|---|---|---|
| Workspace signup, business profile, services, hours | ✅ | API tests, e2e-live |
| Staff desk, hand-overs, least-busy routing | ✅ | `test_desk.py`, e2e |
| Availability and booking against the real diary | ✅ | `reception.py`, tests |
| Rescheduling | 🟡 | Hand-over to staff only. No automatic move. |
| Data export and account deletion | ✅ | `test_privacy.py`, e2e clean-up |

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
