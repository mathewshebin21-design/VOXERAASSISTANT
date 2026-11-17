# Phase 11 — Billing and subscription acceptance contract

Status: **Foundation implemented on draft PR #63; production activation blocked**. Migration 0014, pure subscription policy, tenant-scoped read-only entitlement evaluator, synthetic-only atomic usage writer, and PostgreSQL acceptance tests are implemented. No payment provider, charge, tax determination, or live entitlement enforcement is activated. This work is based on integrated candidate PR #62 and must remain isolated from production.

## Scope and invariants

- One authoritative tenant-scoped subscription state machine; no cross-workspace entitlement sharing. All writes require workspace authorization and audit events.
- States: `trialing`, `active`, `past_due`, `paused`, `canceled`, `expired`. Define provider-neutral transitions, effective timestamps, grace period and access behavior before coding.
- Separate commercial billing from the existing **safety** spend and model-admission gates. A paid plan must never override country, phone, model, consent, or global cost kill switches.
- Store amounts in integer minor units with ISO 4217 currency; GBP and INR plans must have distinct price versions. Never silently convert currency or use floating point for money.
- Meter provider events idempotently with immutable event identity, tenant, service, event time, ingestion time, source and unit. Reconcile reserved, consumed, refunded and failed usage against provider evidence; never bill simulated/test usage.
- Subscription entitlements are evaluated server-side; the browser is informational, not an authority. Fail closed for new paid resource creation when entitlement cannot be verified, while preserving safe access to existing customer data.
- Verify signed provider webhooks against raw payload, timestamp and replay controls. Deduplicate event IDs; support out-of-order, delayed, repeated and conflicting events via fetch-and-reconcile, not blind event ordering.
- No card data or payment secrets stored in VOXERA. Hosted checkout and provider tokens only, after separate approval.
- Invoices, refunds, tax treatment and business registration requirements require finance/legal confirmation for each jurisdiction. Do not assert UK VAT or Indian GST rates without verified evidence.

## Suggested implementation slices (approval-gated where applicable)

1. **Schema and state machine:** tenant-bound plans, immutable price versions, subscriptions, entitlement snapshots, usage ledger, provider event inbox and audit history. Add tenant RLS, foreign keys, restricted runtime grants, migration round trip and concurrency tests on disposable PostgreSQL only.
2. **Entitlement evaluator:** pure deterministic evaluation, cache invalidation, downgrade effective dates, limits, trial expiry, past-due grace policy and concurrent reservation handling. Preserve all existing telephony launch gates.
3. **Usage ledger:** idempotent reservations/settlements, refunds and reconciliation for calls, minutes, STT/TTS, LLM tokens, notifications and storage. Record provenance and provider reconciliation state; reject synthetic usage.
4. **Payment adapter:** interface plus fake provider first. Test signature failures, duplicate and out-of-order events, failed renewals, cancellations, retries and reconciliation. No real provider configuration or live billing.
5. **Customer UI and admin:** clearly distinguish estimates, pending settlement and invoiced charges; GBP/INR plan versions; invoices and cancellation policies subject to review.
6. **Commercial gate:** obtain owner approval of provider, pricing, country/tax treatment, external messaging and production activation; then run separately approved provider sandbox and hosted acceptance.

## Required test matrix

| Scenario | Required result |
| --- | --- |
| Tenant A attempts to access tenant B subscription or invoice | Denied at API and database RLS |
| Two simultaneous reservations at a hard usage limit | At most one accepted; no negative balance |
| Duplicate provider event or retry after crash | Exactly one durable financial effect |
| Events arrive out of order | Reconcile to authoritative provider state |
| Webhook invalid signature, stale timestamp or wrong tenant | Reject, audit, no entitlement change |
| Currency mismatch, price-version mismatch or fractional minor unit | Reject without charge |
| Trial expiry, downgrade, payment failure, cancellation and refund | Deterministic documented access and ledger behavior |
| Existing safety kill switch on paid plan | Telephone/media operation still refused |
| Synthetic call, fake provider or test tenant | Zero billable usage |
| Migration upgrade, rollback, repeat upgrade and restricted role | No tenant leakage or lost ledger entries |
| Provider timeout after accepted payment | No blind duplicate charge; reconciliation required |
| Invoice/export/deletion/retention | Preserve legally required records without exposing other tenants |

## Evidence to capture

Exact commit SHA, migration identifier, test commands and results, database marker, synthetic tenant isolation, provider adapter mode, pricing version, security review, and approval references. Phase 11 remains **In Progress**, not commercially complete. The isolated foundation has executable tests, but authenticated real-usage provenance, quota reservations, webhook verification, provider reconciliation, invoices, tax review, and launch approval remain open.

## Dependencies and prohibited shortcuts

Depends on Phases 0, 1, 6, 9 and 10; integrate only after reviewing PR #62 and the open release stack. Do not merge to production, run shared database migrations, activate payment services, send invoices or contact customers without explicit owner approval.
