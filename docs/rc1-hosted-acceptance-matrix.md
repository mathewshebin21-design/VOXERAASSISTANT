# RC-1 hosted acceptance matrix

Target: the isolated Preview of `codex/rc1-validation` only. Synthetic tenants, users and
appointments only (`@rc1-acceptance.example`), deleted at the end of the run. No paid
providers: none are configured on Preview, and all usage caps default to 0.

Runner: GitHub Actions workflow `rc1-hosted` (on push to `codex/rc1-validation` or by hand).
Nothing is written unless the read-only isolation gate passes first. The gate proves from
the live runtime connection:
- the deployed commit;
- the database marker `staging` and schema `0007`;
- runtime role `voxera_app`: not superuser, no BYPASSRLS, dedicated `neondb`;
- the web Preview's server calls exactly the RC-1 API.

The evidence (`rc1-acceptance.json`, `rc1-a11y.json`) is uploaded as a run artifact.

| Area | Checks (script) | Local rehearsal | Hosted |
|------|-----------------|-----------------|--------|
| Isolation gate | commit, marker, schema, role, dedicated DB, web upstream (`rc1-isolation.mjs`) | 18/18 unit cases | Not run |
| Authentication | sign-up, duplicate, weak password, wrong password, uniform error, refresh rotation, reuse revokes session, logout (`rc1-acceptance.mjs`) | Pass | Not run |
| Rate limiting | 429 within 8 failed logins | Pass (single process) | Not run (F2) |
| JWT | none, garbage, tampered signature, swapped subject, foreign secret, `alg=none`, expired claim, lifetime ≤ 15 min, iss/aud | Pass | Not run |
| Tenant isolation | 10 cross-tenant reads, service by ID, booking into A, A's IDs via B's paths, list leakage, invitations | Pass | Not run |
| RBAC | viewer read-only; staff book/cancel only; no services/settings/invite/promote/export/delete; audit trail | Pass | Not run |
| Scheduling | availability, time zone (+05:30), naive vs offset, hours, past, horizon, quarter hour, phone | Pass | Not run |
| Concurrency | 8 parallel bookings of one slot → exactly one; 2 parallel reschedules → one | Pass | Not run |
| Rescheduling / cancellation | move frees old slot, taken slot refused, idempotent cancel, no move after cancel, rebook, history | Pass | Not run |
| Idempotency | Staff API has no key (note); duplicates prevented by capacity | Note | Not run |
| Security | headers, CORS, minimal error bodies, no credential strings | Pass | Not run |
| Reliability | health commit, readiness, 20 concurrent reads, isolation unchanged after writes | Pass | Not run |
| Browser | `e2e-designs-live.mjs`: real sign-up/sign-in, dashboards, setup assistant, undo, clean-up | Green in CI (`live-e2e`) | Not run |
| Accessibility | axe-core WCAG 2.1 A/AA, 6 entry pages, first-Tab focus (`rc1-a11y.mjs`) | 6/6 after fix D2 | Not run |
| Production isolation | no production action | Verified | — |

Not covered on the hosted run, and why:
- DST transitions: none falls inside the 60-day booking horizon for the test zones.
- Expired tokens signed with the real key: the suite never sees the key. Unit tests cover it.
