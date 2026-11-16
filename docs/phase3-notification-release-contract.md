# Phase 3: external staff notification release contract (design gate)

Status: **PROPOSED / NON-PRODUCTION**. This document does not authorize a real provider, sender, telephony, billing, production deployment, or migration. The existing in-memory simulator is not a transport adapter.

## Observed implementation boundary

At PR #58, `simulate_batch` commits a lease, commits a case-handled recheck, invokes an in-memory transport, and commits the synthetic outcome. The case can be acknowledged or resolved **after the recheck and before the transport call**. Therefore the second checkpoint narrows but cannot eliminate that race. Do not claim a guarantee that handled cases can never receive a notification.

A transport may accept an external request and the worker may crash before `provider_accepted` is committed. The same notification may be retried after lease expiry. Reusing a stable identifier in the simulator is not proof that an actual provider deduplicates requests.

## Required production adapter contract

1. **Approval and recipient policy:** explicitly approve provider, geography, spend cap, recipient resolution, message content, opt-out/privacy handling, and audit evidence. No runtime `test` switch can bypass the phone launch gate.
2. **Pre-send checks:** validate tenant, immutable case and notification identity, active lease, expiry, case status and staff acknowledgement, and permitted channel. Recheck as close to submission as practical. Document that an acknowledgement after the last check may race with an already submitted external request.
3. **Idempotency:** use a stable, opaque notification ID as the provider idempotency key **only if the selected provider documents durable deduplication semantics and retention**. If the provider cannot guarantee this, do not automatically resubmit ambiguous requests: move them to a reconciliation/manual-review state. Never assume exactly-once external delivery from database transactions alone.
4. **Crash recovery:** persist an attempt identity before submission, reconcile accepted-but-uncommitted attempts using provider evidence when available, and prevent silent duplicate dispatch. Define bounded retry and dead-letter behavior for network timeouts and ambiguous responses.
5. **Callbacks:** verify provider signature using raw payload and configured secret, enforce timestamp tolerance and replay/event-ID deduplication, map opaque provider reference to one tenant-bound notification, reject out-of-order transitions, and separate provider acceptance, provider-reported delivery, and explicit human acknowledgement. Never trust caller-supplied organization IDs.
6. **Data protection:** keep outbox and attempt logs free of caller message bodies and recipient PII; redact provider errors and references as appropriate; restrict callback logs, secrets, and retention.
7. **Operational visibility:** show queued, accepted, delivered, failed, and human-acknowledged as distinct states. Manual review is not an automatic escalation or a callback promise.

## Required isolated acceptance matrix

- Acknowledgement/resolution before leasing, after leasing, and after pre-send recheck but before submission; demonstrate and document the final race boundary.
- Two workers contending for the same due item; stale lease, expiry, retries, and worker crash at each transaction boundary.
- Provider accepts request but database commit fails; retry only with provider-proven deduplication or explicit reconciliation, never blind re-send.
- Provider timeout with unknown acceptance; duplicate callbacks, forged signatures, expired timestamps, cross-tenant references, and out-of-order delivered/accepted events.
- PostgreSQL migration 0013 upgrade and rollback on disposable database, RLS isolation, tenant foreign keys, and zero real transport invocations.
- Exact-head CI, API/browser regression, security review, and explicit approval before any shared environment migration or external adapter activation.

## Release decision

**Blocked.** Passing PR #58 CI establishes only the tested simulator behavior. Real notification delivery, provider reconciliation, and full phone-to-human handoff remain unverified.