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

Hosted run: `rc1-hosted` run 42297447382 at `ad98ff6` (2026-11-06), evidence artifact ID 13542159106.

| Area | Checks (script) | Local rehearsal | Hosted |
|------|-----------------|-----------------|--------|
| Isolation gate | commit, marker, schema, role, dedicated DB, web upstream (`rc1-isolation.mjs`) | 18/18 unit cases | Pass (before and after) |
| Authentication | sign-up, duplicate, weak password, wrong password, uniform error, refresh rotation, reuse revokes session, logout (`rc1-acceptance.mjs`) | Pass | Pass |
| Rate limiting | 429 within 8 failed logins | Pass (single process) | Pass (429 within 8; see F2) |
| JWT | none, garbage, tampered signature, swapped subject, foreign secret, `alg=none`, expired claim, lifetime ≤ 15 min, iss/aud | Pass | Pass (`alg=none` refused 403 at edge; API 401) |
| Tenant isolation | 10 cross-tenant reads, service by ID, booking into A, A's IDs via B's paths, list leakage, invitations | Pass | Pass |
| RBAC | viewer read-only; staff book/cancel only; no services/settings/invite/promote/export/delete; audit trail | Pass | Pass |
| Scheduling | availability, time zone (+05:30), naive vs offset, hours, past, horizon, quarter hour, phone | Pass | Pass |
| Concurrency | 8 parallel bookings of one slot → exactly one; 2 parallel reschedules → one | Pass | Pass |
| Rescheduling / cancellation | move frees old slot, taken slot refused, idempotent cancel, no move after cancel, rebook, history | Pass | Pass |
| Idempotency | Staff API has no key (note); duplicates prevented by capacity | Note | Note |
| Security | headers, CORS, minimal error bodies, no credential strings | Pass | Pass (HSTS present; `/docs` exposed, F3) |
| Reliability | health commit, readiness, 20 concurrent reads, isolation unchanged after writes | Pass | Pass |
| Browser | `e2e-designs-live.mjs`: real sign-up/sign-in, dashboards, setup assistant, undo, clean-up | Green in CI (`live-e2e`) | Pass 14/14 |
| Accessibility | axe-core WCAG 2.1 A/AA, 6 entry pages, first-Tab focus (`rc1-a11y.mjs`) | 6/6 after fix D2 | Pass 6/6, 0 violations |
| Production isolation | no production action | Verified | — |

Not covered on the hosted run, and why:
- DST transitions: none falls inside the 60-day booking horizon for the test zones.
- Expired tokens signed with the real key: the suite never sees the key. Unit tests cover it.
