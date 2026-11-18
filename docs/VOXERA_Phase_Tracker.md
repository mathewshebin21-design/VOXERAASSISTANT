## Phase 11: billing foundation — active validation (2026-11-18)

**Scope:** Synthetic, isolated billing only. PR #63 remains draft; no live payments, telephony, production migrations, or production deployments are authorized.

| Workstream | Status | Verified evidence / next gate |
|---|---|---|
| Billing model, synthetic ledger, tenant-scoped storage and read-only overview | Implemented on development branch; release pending | PR #63, branch `codex/voxera-phase11-billing-contract-20261117`; require full API, migration and frontend validation |
| Python Ruff formatting | Fixed on branch; revalidation pending | Automated maintenance run [44223499934](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44223499934) succeeded; commit `8396997` |
| Duplicate-field JSON validation regression | **Verified fixed in multiple API CI runs** | Previous API run [44223823916](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44223823916) failed; fix `7877d14` passed [API run 44224244019](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44224244019); [run 44224640827](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44224640827) passed on `eb51669` |
| Frontend dependency security | **Blocked; upstream remediation required** | `npm audit` reported 20 high findings in the picomatch dependency tree; its report labels `picomatch *` vulnerable (GHSA-fc5q-39xc-vjpf), so no safe patched version is established. Forced upgrade failed on `$postcss` and attempted incompatible major versions; no audit bypass accepted. See [44223817164](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44223817164) |
| Frontend test visibility | **Lint, typecheck, unit tests, script tests and build verified; E2E pending** | Run [44224578388](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44224578388) passed lint, typecheck, unit tests, script tests and build; security gate failed, E2E skipped on that run. Commit `a204d9a` moves security enforcement after E2E |
| Integration CI | Verified on `a204d9a`; current-head validation pending | [44224601254](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44224601254) passed; newer runs must pass at current head |
| CI concurrency control | **Verified cancellation of superseded runs** | Commits `523bec6`, `d91178b`, `de76004` add branch/PR concurrency; GitHub Actions cancelled superseded API, integration and previews runs at `de76004` (44225289123, 44225289152, 44225289291). Some older runs started before this policy remain active |
| Temporary maintenance workflow | Removed after formatter repair | Commit `7504406` deletes `.github/workflows/phase11-maintenance.yml` from development branch; release security gate remains in `previews.yml` |
| Production promotion | **Not authorized** | Draft PR #63 must remain unmerged until owner approval and all release gates pass |

**Tracker update policy:** Update this section with each material commit, confirmed CI outcome, blocker change, or release decision. Distinguish a committed fix from a verified passing run; record run IDs and commit SHAs. Do not mark a phase complete without acceptance evidence.

---

# VOXERA Phase Tracker

## Canonical execution register — 17 November 2026 (Asia/Kolkata)

The owner's **Master GPT Work Execution Roadmap** supplies the current Phase 0–13 execution labels. Its table is provisional where historical definitions conflict. Preserve all requirements through the crosswalk below. The prior canonical Phase 0–10 dashboard and the historical release ledger are retained at the end of this file.

| Current phase and owner scope | Original 0–10 crosswalk | Earlier expanded 0–13 crosswalk |
| --- | --- | --- |
| 0 Infrastructure and Security | 0 Infrastructure and isolation, part of 10 | 0 Infrastructure and Security |
| 1 Core SaaS | 1 Receptionist and onboarding, tenancy from 0 | 1 Core SaaS Application |
| 2 Business Operations | 2 Appointments and staff, parts of 1 and 7 | 2 Call Management and Business Operations, booking from 5 |
| 3 AI Agent Studio | 3 Agent Studio | 4 AI Agent Studio |
| 4 Testing Lab | 4 Testing Lab, QA tooling from 7 | Testing Lab in 4, test programme in 10 |
| 5 Browser Voice | 5 Browser voice | Browser voice in 4, speech in 3 |
| 6 Production Voice Engine | Voice engine from 5–6 | 3 Production-Grade Voice Receptionist |
| 7 Telephony | 6 Telephony | SIP/PSTN and number routing from 3 |
| 8 Integrations | 8 Integrations | 5 Appointments, Integrations and Automation |
| 9 Analytics | Analytics from 7 Operations, analytics and QA | Reporting from 2, 6 and 8 |
| 10 Security and Reliability | Security, performance and launch controls from 10, QA and operations from 7 | 8 Administration and Operations, 10 Complete Quality Assurance, technical gates from 11 |
| 11 Billing and Subscriptions | 9 SaaS and billing | 6 Subscriptions, Billing and Monetization |
| 12 Commercial Product Experience | UX from 1, 3 and 10 | 7 Premium Product Design, 12 Commercial Productization |
| 13 Launch Readiness | 10 Launch, security and commercial readiness | 9 UK and India Compliance Readiness, 11 Release Engineering, 13 Pilot and Commercial Launch |

“Phase 3 release candidate” in existing PR titles and in the immediate priority refers to the older voice release. Its work spans current phases 0, 2, 6, 7, 8 and 10. Current Phase 3 is Agent Studio. Phase status reflects final acceptance, while individual evidence below names the code and environment covered.

| Phase | Status | Existing implementation and evidence | Remaining acceptance and dependencies |
| --- | --- | --- | --- |
| 0 | In Progress | PR #47 retired the PR28 migration job. PR45 isolated 0012 migration and hosted separation verified. | Recheck repository protection and settings, branch-only runtime identity, production recovery point and tested restore. Keep backups. Release and shared schema writes require owner approval. |
| 1 | In Progress | Workspace auth, sessions, permissions, business config, export and account lifecycle in `services/api/app/routers`. Historical production evidence below and PR45 hosted synthetic checks. | Verify current release candidate onboarding, invitations, positive/negative role paths, export/delete and account lifecycle across desktop and mobile. Depends on 0 and exact deployed source. |
| 2 | In Progress | Local appointments, staff desk, cases, call history and consent. #49 and #55–#57 add durable fallback, human acknowledgement and notification visibility. | Verify lead/enquiry lifecycle, concurrent booking, DST, staff shifts/skills/locations, call summaries, retention and staff desk on integrated source. External bookings and messages require approval. |
| 3 | In Progress | Draft PR #61 ports the visual editor, draft revisions and immutable simulation versions from PR #2 onto the integrated candidate. Studio pricing uses the workspace currency. | Verify workspace configuration, FAQ, policy, publish/rollback, simulation data retention and immutable live version selection. Depends on 0–2 and 4. |
| 4 | In Progress | PR #61 restores the deterministic Testing Lab and uses the flow lock to serialize first-time creation of the default suite. The browser simulator and scripted-call harness run in synthetic integration CI. | Verify persisted scenario/version linkage, realistic regression corpus, scored evaluation, actionable failures, publish gating and test-run authorization. |
| 5 | In Progress | Browser Voice Lab and synthetic provider integration. | Measure audio, language switching, latency, interruption and error recovery on browser devices with approved providers or local engines. Depends on 3, 4, 6. |
| 6 | In Progress | #40/#41 included in #45. Worker timeout recovery, lifetime bound, model attestation gates, call binding and notice tests in #50/#53/#54. | Independently verify approved model, language, geography, budget, usage reconciliation and real audio. Exercise TTS/STT disconnect, interruption, mixed-language/noisy calls and long sessions. Paid providers require approval. |
| 7 | Blocked | #41/#45 map numbers to tenants. #50 binds phone credentials to a call. #51 adds SIP ingress checks, #52 prevents phantom transfer, #53/#54 enforce notice and pre-notice privacy. | Carrier/trunk/dispatch verification, actual notice playout and consent, reliable transfer and hangup, provider limits and realistic UK/India call acceptance. Require model/carrier/legal evidence and owner approval before real calls. |
| 8 | In Progress | #56 durable outbox, #57 desk visibility, #58 in-memory transport, #59 production adapter contract. Local booking and staff handoff foundations. | Verify calendar OAuth, CRM, signed and replay-safe callbacks, bounded retries, reconciliation, dedupe and truthful external outcomes. Approve providers/accounts/recipients before any external action. |
| 9 | In Progress | Call events, usage, dashboard and synthetic metrics. | Validate tenant-scoped reporting and call outcomes, metering reconciliation, staff dashboards, exports, call quality and reporting accuracy. Depends on 2, 6–8 and 11. |
| 10 | In Progress | Tenant RLS, auth/RBAC, rate limiting, sanitized metrics and migration verification. #54 adds pre-notice safeguards. | Exact deployed-source privacy/regression checks, abuse, load, backpressure, dependency review, retention scheduling, observability, incident procedures, restore and forward recovery. |
| 11 | In Progress | Draft PR #63 adds pure subscription/usage policies and migration 0014 for tenant-scoped subscription snapshots, usage ledger and provider inbox. CI at `2a178e1` passed API tests (including atomic synthetic-only usage ingestion, replay conflict detection, tenant RLS and timestamp validation), database migration round-trip, Docker builds, frontend and synthetic integration. The usage writer is not connected to production call provenance or payment transport; no charges enabled. | Verify authenticated usage provenance, transactional idempotency and reconciliation, plan enforcement, trial, signed webhook, invoice, tax, refund, renewal and failed-payment sandbox journeys. Price with current verified costs. Live payments require approval. |
| 12 | In Progress | Flow is approved design direction. Authenticated dashboards plus browser-only demos. | Distinguish demo and real features, verify premium mobile/desktop accessibility, agent self-service, onboarding and support. Prepare accurate positioning, UK/India packages, demo, FAQs, docs and cancellation. |
| 13 | Blocked | Issue #44 and commercial readiness document list open gates. | Obtain UK/India legal review and current provider, data processing, consent and tax evidence. Prepare policy/DPA/terms, recovery and incident runbooks, pilot metrics, final immutable release report and monitored smoke checks. Production promotions, pilot calls, customer outreach and commercial launch need explicit approval. |

### Current release evidence

- Production branch `claude/confident-shannon-7nb05f` was read at `21c5ac9e3ca3bb6dd9a2a5a5ad1dce760882e650`. Production Neon and shared staging both independently returned `0011` with their expected markers. Latest production API Vercel attempt `dpl_73pRt66f54LCna66LvUDbButXeoH` refused schema mismatch. Frontend `dpl_5uAKRiBunVXvHsBNUhgTZ6VtKD77` reports READY. Build history alone leaves live alias health unverified.
- PR45 isolate `blue-night-16595257/br-shy-math-zaczmtq5` returned `0012 / staging`. Migration run [43866923135](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43866923135) passed. Hosted runs [43872852247](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43872852247) and [43874094532](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43874094532) passed on the earlier pinned Preview application commit `2839e46`. Current PR45 head `e529f93` contains later provider gates, so those hosted runs establish only the older deployment.
- The stack is linear through PR #59. [PR #60](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/60) integrates it at `f6fbf97`. [API and 0013 rehearsal](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43953790874), [worker and offline SIP admission](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43953790981), [frontend and accessibility](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43953790935) and [synthetic integration](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43953791003) all passed. The API rehearsal verified 86 checks at 0012 and 105 at 0013 and kept both seeded tenant cases through rollback, repeated upgrade and downgrade/re-upgrade.
- [PR #61](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/61) restores Studio and Testing Lab as a draft on #60. [API run 43955637004](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43955637004) passed on the workspace-currency fix. Consult PR #61 checks to verify the current head.
- The production API alias returned HTTP 200 from health and readiness at `7ba1fcb`. Branch-specific API database settings and the web API upstream are configured on #45 only. Vercel rate-limited the new API Previews. Hosted 0013 acceptance requires a separate isolated target and matching API/frontend revisions.
- Migration 0013 adds a unique constraint to existing cases, RLS-protected outbox and attempts tables, tenant-bound composite foreign keys and restricted grants. The new rehearsal verifies seeded 0012 data after injected rollback, upgrade, repeated upgrade, downgrade and re-upgrade on a disposable GitHub PostgreSQL service. Hosted 0013 is pending.
- Notification idempotency on an external provider remains unproven. Case acknowledgement can race an already submitted request. Approval and provider-backed reconciliation remain required before implementing live delivery.
- The existing approval covers isolated PR45 migration 0012 only. The new GitHub Actions rehearsal uses loopback PostgreSQL, synthetic fixtures and in-memory transport. It consumes no new Neon resources. The $10 warning and $15 threshold are requested cost controls, with enforcement still subject to provider evidence.

### Stack checked at start of integration

| PR | Head | Depends on | Scope |
| --- | --- | --- | --- |
| [#45](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/45) | `e529f930aad8a5e1e7ed7a3acfabdbf5a5f83180` | `claude/confident-shannon-7nb05f` | Release candidate: voice routing, bounded call recovery and canonical phase verification |
| [#48](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/48) | `152e4491e6fcc694c25cd84cfc6b97fadd6826e3` | `codex/uk-india-release-candidate-20261116` | fix(worker): fail closed when fallback message has no delivery acknowledgement |
| [#49](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/49) | `038545751442a56c21185b9a64aabecba85b66f3` | `codex/worker-fallback-truthful-20261116` | feat(worker): persist simulated fallback messages in staff queue with acknowledgement |
| [#50](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/50) | `70184a8e5d28ae5e950108ec29aa2f81c9b29341` | `codex/worker-fallback-queue-20261116` | security(worker): bind telephone credentials and inference to one immutable call |
| [#51](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/51) | `7008dea93f2025f84b25ac110dfd67b490abecc1` | `codex/worker-call-bound-credentials-20261116` | security(sip): deny unreviewed inbound trunk and dispatch routes before call admission |
| [#52](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/52) | `3479539da7f84af18321029efd23b8a890e4ce7e` | `codex/verified-sip-ingress-gate-20261116` | safety(phone): block phantom staff transfers without carrier confirmation |
| [#53](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/53) | `f395811fcd83c3266ea3c2101d7ddce1715fcd4d` | `codex/no-phantom-phone-transfer-20261116` | safety(phone): require call-bound AI/recording notice playout before listening |
| [#54](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/54) | `8d7eea906f3279cc7bbb66d893f3d8a0f37bbc15` | `codex/phone-notice-playout-proof-20261116` | privacy(phone): redact pre-notice event metadata and block spoofed receipt evidence |
| [#55](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/55) | `509b0115acf36019130893b6a9fe802be28374c1` | `codex/phone-prenotice-metadata-privacy-20261116` | feat(desk): explicit human case acknowledgment without phantom notification delivery |
| [#56](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/56) | `dcedb26a41f755d89dae6c2fcb6bd6e7e7b6bd73` | `codex/staff-case-acknowledgement-20261116` | feat(notifications): transactional staff outbox, bounded retries and separate delivery evidence |
| [#57](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/57) | `0ff6a94af23c59dec741dabfb1cc6909801fa08b` | `codex/staff-notification-outbox-20261116` | feat(desk): truthful notification visibility and manual staff-review triage |
| [#58](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/58) | `3f506da2894694405bc4bac84c33fac85cada712` | `codex/notification-attention-desk-20261117` | test(notifications): fail-closed fake dispatcher and recheck-before-send cancellation |
| [#59](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/59) | `030c6e4b750b523daeaea5e0dad8c7adf237e952` | `codex/notification-sandbox-dispatcher-20261117` | docs(safety): formalize Phase 3 notification provider release contract |

### Next executable gate

PR #60 passed integration CI. PR #61 reconciled PR #2 and passed API, frontend and synthetic integration CI on `2200c66`, with [16/16 Studio browser checks](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43956568730). On 17 November (IST), Vercel still reported rate-limited deployment checks. The only Flow Preview for #61 was built from an earlier commit, and no matching API Preview or dedicated hosted 0013 branch was present.

Hosted acceptance requires a dedicated synthetic-only Neon branch. Record the precise branch, endpoint, environment marker and runtime role. Use the existing release verifier to check schema `0013`, grants, tenant isolation and notification outbox constraints. Verify the matching API and Flow Preview commits and the Flow server's binding to the isolated API before creating synthetic accounts. Confirm the accounts and their workspaces are removed after the run. See the earlier [PR45 isolation evidence](pr45-isolated-validation.md). The PR45 branch serves as the historical `0012` baseline.

The staff-desk follow-up cancels pending and retrying notifications when a case is explicitly acknowledged or resolved. Reopening the case leaves that cancellation in effect. A leased attempt keeps its pre-dispatch recheck and historical provider receipts stay in their recorded states. Verify these outcomes in API and browser CI. External dispatch acceptance, real calls and production migration still require separate approval.

## Retained original Phase 0–10 dashboard — 2026-11-16 (Asia/Kolkata)

**Owner requirement: complete every phase and verify everything. No inferred completion percentages.**
Canonical numbering is **0–10**, recovered from the owner's `VOXERA_Phase_Tracker.md`,
version 17, canonical dashboard. This supersedes the provisional phase labels in historical
repository documents and PR titles. Historical evidence below is retained, not silently rewritten.

Each requirement needs: acceptance criterion, exact source SHA, environment/database identity,
test command or workflow URL, observed result, date, residual limitations and approval reference
where required. Use separate states for **implemented**, **CI verified**, **hosted verified**,
**production verified**, **blocked**, and **not run**. A phase is complete only when all applicable
acceptance requirements have evidence. Fake-provider tests never establish real audio/PSTN quality.
A successful build, merged migration file or upgraded service plan is not launch acceptance.

| Phase | Canonical scope | Current acceptance state and next gate |
| --- | --- | --- |
| 0 | Infrastructure and isolation | Production database read-only verified at 0011. Source contains 0012; latest API build refuses mismatch. Fresh recovery point, protected migration, restore evidence and exact deployed-source parity remain open. |
| 1 | Receptionist and onboarding | Historical production acceptance exists below. Revalidate complete current candidate: auth/session, persistent configuration, onboarding, permissions, booking flow and rollback. Do not treat earlier receipts as current-source acceptance. |
| 2 | Appointments and staff | Scheduling/rescheduling and staff foundations have historical evidence. Complete requirement coverage for skills, shifts, holidays, locations, concurrent booking and timezone/DST behavior; current hosted acceptance required. |
| 3 | Agent Studio | PR #2 is still open/unmerged at 15a89715a2a5437c839dcbdd9c1fa320a646be02 and targets an old branch. Reconcile with current production, preserve safety fixes, complete node/version/publish requirements and rerun acceptance. |
| 4 | Testing Lab | Implementations/evidence partly live in unmerged PR #2. Verify deterministic scenarios, explicit failure reporting, evaluation matrix, version linkage and publish gating on the integrated source. |
| 5 | Browser voice | Existing browser implementation and simulated checks. Real listening, interruption, language switching, latency and provider-policy enforcement remain unaccepted. |
| 6 | Telephony | PR #45 integrates saved policy/number mapping, transcription recovery and an independent lifetime guard. Live inbound calls, actual transfer/hangup, disclosures, provider controls and country sign-offs remain blocked; no PSTN launch evidence. |
| 7 | Operations, analytics and QA | Call records and simulated metrics exist. Verify durable fallback messages, actual outcomes, takeover, retention scheduling, monitoring, load and incident handling. |
| 8 | Integrations | Validate OAuth, calendars, CRM, signed deliveries, replay/retry/revocation, and ORCHESTRA/REVORA contracts. Demos/interfaces are not live integration acceptance. |
| 9 | SaaS and billing | Usage foundations exist. Implement and verify entitlements, subscription/payment lifecycle, invoice/tax handling, GBP/INR plans and cost reconciliation. Paid activation remains approval-gated. |
| 10 | Launch, security and commercial readiness | BLOCKED for both UK and India. Requires current security/dependency, tenant isolation, privacy, accessibility, performance, recovery, real-call, billing and hosted release evidence plus owner sign-off. |

Current release work: [PR #45](https://github.com/mathewshebin21-design/VOXERAASSISTANT/pull/45).
Detailed blockers and production release sequence:
[UK/India commercial readiness](uk-india-commercial-readiness.md).

Verification completed during this continuation on code commit
`a018385ebcb78fec07a0d816840724c0f0ba6760`:
worker lint/format, 110 core tests (3 optional skips), 37 real-SDK adapter tests;
API lint/format, pytest, migration round-trip and Docker steps passed in
[API run 43748910546](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43748910546).
Worker/container evidence:
[run 43748910476](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43748910476).
Full latest-head CI and hosted acceptance must still be checked after subsequent changes.
No production migration/merge/deploy, backup deletion, paid activation or external customer action
was performed in this continuation. Existing approval gates remain intact.

## Historical release ledger

The phase numbers in the retained sections below are historical repository labels, not the
canonical roadmap above. Their status statements apply to their recorded dates and commits.

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
| 29 | Receptionist wording by business country (currency, emergency numbers) | Branch `claude/phase2-global` | `93a3ec7`; `tests/test_regions.py`; no number marked verified; unknown country gets no guessed number |
| 30 | Scoped worker credential, worker brain endpoint, token refresh | Branch `claude/phase2-global` | `f96c480`, `df12e32`; 6 API + 5 worker tests; stand-in call via minted, refreshing token; endpoint off unless `VOXERA_WORKER_SECRET` set |
| 31 | Languages page (registry, route preview, providers) | Branch `claude/phase2-global` | `5414e21`; browser e2e 8/8 against the real API; in the integration workflow |
| 32 | Multilingual safety scenarios (injection in ar/ml, yes-before-booking in hi, emergency by business country) | Branch `claude/phase2-global` | `797c3a1`; harness 17/17 stand-in scenarios (plumbing); API test: UAE business gives UAE numbers whatever the caller speaks |
| 33 | Launch gate per country; live worker tokens refused until signed off | Branch `claude/phase2-global` | `app/voice/launch.py`; no country signed off; `docs/launch-country-checklist.md`; Languages page shows outstanding checks (browser e2e 9/9) |
| 34 | The voice worker records its own calls into call records | Branch `claude/phase2-worker-recording` (combines #28 and #29) | `/v1/worker/calls`; channel from the token; one writer in spoken order; 11 API tests (12 cases) and 9 worker tests; stand-in call recorded and read back (simulated) |
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
