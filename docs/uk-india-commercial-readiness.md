# UK and India commercial release readiness

Assessment date: 2026-11-16 (Asia/Kolkata). **Not approved for paying customers.**
Tracking: issue #44. Integrated candidate: PR #45.
This document is an engineering release record, not a legal opinion or an approval.

## Verified state

- Production Git branch: `claude/confident-shannon-7nb05f`, `f7f89d6ad629b227a36679b70087f4dc47f68892`.
- Read-only production database query returned Alembic `0011`.
- Migration `0012` is in source but has not been applied to production.
- Vercel production API attempt `dpl_HEfzikx3ov2g9vCukC1H3yza2nue` refused schema mismatch.
- Latest READY API deployment returned by Vercel: `dpl_GmmQDmDVTEnWzDkcMmYh1JzaLz5P`, source `7ba1fcb875e462fa6534b52cec83fc77403736d5`.
- Latest READY frontend returned: `dpl_BmhRCfAAvqCq9zi1w4by9cgyX1Ye`, source `f7f89d6ad629b227a36679b70087f4dc47f68892`.
  READY history is not an outside-in health probe or proof of domain routing.
- Neon organization now reports the Launch plan. There are ten production-project branches;
  no fresh 0012 recovery branch was listed. Do not delete existing backups.
- Country launch sign-offs in `app/voice/launch.py` remain empty.

## Candidate changes

PR #45 combines #40 and #41 on the production source baseline and preserves both test sets.
It also pins API Python to 3.12 and worker Python to 3.13 after CI selected unsupported
Python 3.14 for the API's locked PostgreSQL driver.
An independent worker lifetime guard now requests shutdown at the call deadline even
if there is no further transcript; it also observes credential-related session closure.
Actual carrier hangup must still be verified with the selected SIP provider.

CI tests use temporary databases and stand-in providers. They do not demonstrate
live audio, paid-provider correctness, country compliance, or commercial launch readiness.
Use PR #45's latest commit checks, not historical green checks.

## Engineering gaps that block real callers

| Gap | Required implementation and evidence |
| --- | --- |
| Workspace policy vs actual providers | **Two fail-closed boundaries now implemented on PR45:** the worker's LiveKit STT/TTS gate checks exact source-reviewed speech-model attestations before media startup, while the API's `/v1/worker/live/brain` checks each reasoning-model turn against the workspace's current allowed language, blocked provider, paid consent, all known processing regions and approved model-language evidence **before token reservation or provider inference**. Both reviewed-model registries are intentionally empty, so no real provider is approved yet; `test` worker credentials do not bypass either gate. Offline tests use explicitly injected hypothetical attestations. Remaining requirements: independent provider/model residency and pricing evidence, approved registry entries, real usage/cost metering and reconciliation, complete provider-side limits, speech policy enforcement after model/language changes, and real-audio acceptance. The member-facing Voice Lab retains its separate budget/authorization path and is not a telephony launch authorization. |
| Speech cost control | API unit reservations cover its model/TTS requests; LiveKit inference is a separate path. Add call admission/concurrency and actual speech usage accounting, reconciliation and provider-side spending controls. A time limit is not a monetary cap. |
| Disclosures | Worker does not yet play the required AI/recording notices. Keep notice flags false until playback is verified; do not store transcript words without the applicable consent decision. |
| Message fallback | Session fallback collects answers in worker memory. Do not equate that with a delivered staff message or promise a callback without durable case creation and acknowledgement. Add deterministic persistence, idempotency and failure tests. |
| Human transfer | API handoff events do not establish that a telephone transfer actually connected. Implement carrier/LiveKit transfer with confirmed outcome, busy/no-answer fallback and no false success reports. |
| Language switching | Detection events are not wired into the LiveKit adapter. Validate switching, accents, interruption and fallback with real audio for every marketed language. |
| Record retention | Verify scheduled call housekeeping, retention execution and deletion evidence in the target environment. |
| Operator/customer screens | Complete policy, assigned-number and call-history workflows with role checks, loading/error states and browser acceptance tests. |
| Reliability | Load/concurrency tests, disconnect/cancellation, duplicate calls, rate limiting, retry bounds, monitoring, incident alerts and a demonstrated restore are still release evidence requirements. |

## Follow-on SIP ingress hardening (draft PR #51; not released)

Draft PRs #48–#51 are stacked non-production changes and do **not** supersede the
unmet commercial gates above. PR #50 adds short-lived, signed call references;
PR #51 additionally refuses an inbound SIP job unless its LiveKit trunk ID,
inbound dispatch-rule ID, dialled number, call IDs and ringing/active state
match a source-reviewed route. The allowed-route registry remains **empty**,
even if the operator mistakenly enables `VOXERA_SIP_ENABLED`.
The offline test registry includes only fictional identifiers.

Before any real route can be approved, obtain verifiable evidence of the configured
inbound carrier authentication/IP restrictions, LiveKit project and dispatch rule,
trunk-to-business number ownership, region and carrier eligibility, and independent
call-log correlation. Recording `sip.trunkID` or `sip.ruleID` from a participant
is **not** independent cryptographic proof of inbound carrier identity.
Carrier/SIP admission must be evaluated separately from the API's signed worker
token and workspace/country launch rules. SIP attributes must not be logged
with unredacted call IDs or phone numbers.

Reference: LiveKit's official [SIP participant attributes](https://docs.livekit.io/reference/telephony/sip-participant/)
and [telephony test checklist](https://docs.livekit.io/telephony/testing/).
Neither the source allowlist nor hypothetical CI participant attributes
constitute live-telephony acceptance.

## Commercial acceptance

1. Select the legal contracting and payment entity for UK and India; record the owner-approved
   merchant provider and tax/invoice handling. Do not infer this from a company name.
2. Implement onboarding: business facts, timezone, service duration, availability, staff,
   approved escalation destination, languages, notices, retention and test-call acceptance.
3. Implement billing in test mode: signed webhook verification, replay protection,
   duplicate/out-of-order event handling, entitlement transitions, cancellation/refund states
   and tenant isolation. Never accept a client-supplied paid status.
4. Price GBP and INR plans from measured fully loaded call costs: carrier, number, worker,
   STT, model, TTS, database, support and payment fees. Include failure/retry and concurrency costs.
   No sales price or margin is validated yet.
5. Prepare terms, privacy notice, processor/subprocessor list, data processing agreement,
   support/refund policy and market-specific carrier eligibility. Obtain current source checks
   and appropriate legal/accounting review before claiming compliance.
6. Run an owner-approved internal pilot; keep external outreach, real customers, payments,
   publishing launch claims and paid activation separately approval-gated.

## Production release packet — not executed

1. Record the exact reviewed candidate SHA and green required checks.
2. Obtain approval for a fresh production recovery point and verify its restore procedure;
   preserve all existing backups and confirm any incremental costs.
3. From the protected production ref, run the existing migration workflow's read-only
   check against the exact production database and role.
4. After separate approval, migrate 0011 to 0012; verify the environment claim,
   version, tenant RLS and SELECT-only runtime access to telephone numbers.
5. Promote only the approved candidate after isolated hosted acceptance. Verify API and
   frontend deployed SHA, schema identity, health and synthetic tenant isolation.
6. Keep SIP/media and country gates off. Application deployment is not telephony launch approval.
7. If migration or acceptance fails, stop. Do not downgrade and drop policy/number data;
   choose an explicitly approved forward fix or restore.

## Evidence required to call this ready to sell

A signed release decision must link the exact deployed commits, recovery rehearsal,
isolated and hosted acceptance reports, real call transcripts/audio where lawfully retained,
language/latency/failure results, provider cost reconciliation, security review,
merchant test results and separate UK/India launch sign-offs.
No unchecked item is waived by a successful build or by upgrading the database plan.
