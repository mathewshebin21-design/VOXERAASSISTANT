# VOXERA AI — Project tracker

This is the single place for project status. Two sources feed it:
- **The plan** is the master specification written in ChatGPT. That document isn't in this repository, so the phases below (0–11) come from the agreed vision list and are provisional. Replace them with the specification's 11 phase titles once it is shared.
- **What is actually done** comes only from this repository and checked deployment evidence. Nothing is marked done just because it is documented.

Last updated: 2026-11-02 (branch `claude/agent-studio`, not pushed).

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
| GitHub CI on PR #1 | green | GitHub (last push 469283d) |
| Production deployment | commit 767c0f2 live | https://voxera-api-two.vercel.app, https://voxera-flow.vercel.app |
| Staging deployment | **not done**: no staging database yet | — |
| Real phone calls, real AI provider, real voice | **never tested** | — |

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
| **Separate staging database for previews** | ❌ | No preview/development database variables on voxera-api. **Needs you** (see Dependencies). |
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
| Neon store `voxera-staging` (free plan) connected to voxera-api for **Preview and Development only** | Staging verification, safe PR previews | You (Vercel dashboard) |
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
