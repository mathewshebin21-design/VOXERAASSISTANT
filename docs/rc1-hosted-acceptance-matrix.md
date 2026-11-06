# RC-1 hosted acceptance matrix

Target: isolated Preview of `codex/rc1-validation` only. Synthetic tenants, users and
appointments only; fake providers only (no paid telephony, messaging or AI calls).
No row is marked passed without a linked hosted run.

Gate before any synthetic write: the deployed commit, API endpoint, DB marker
(`staging`) and schema (`0007`) are proven by a passing build preflight, and the
frontend Preview targets that exact API.

| Area | Checks | Status |
|------|--------|--------|
| Authentication | sign-up, sign-in, wrong password, lockout/rate limit, logout | Not run (blocked: no deployment) |
| JWT | signature with RC-1 secret only, expiry, tampered token, foreign-secret token rejected | Not run |
| RBAC | owner/admin/staff/receptionist permissions per endpoint | Not run |
| Tenant isolation | cross-tenant read/write/list by ID guessing, RLS under `voxera_app` | Not run |
| Scheduling | create, double-book concurrency, reschedule, cancel, timezone/DST, idempotency keys | Not run |
| Receptionist/staff workflows | day view, check-in, staff availability | Not run |
| Browser/frontend | sign-in form, dashboard, booking flows against RC-1 API | Not run |
| Accessibility | axe scan of key pages, keyboard navigation | Not run |
| Security/reliability | security headers, CORS, error bodies leak no secrets, health/readiness | Not run |
| Production isolation | production API/web unchanged; production DB untouched | Verified for this phase (no production action taken) |

Execution note: this container cannot reach `*.vercel.app` (egress proxy 403), so hosted
suites must run from GitHub Actions or another runner with a Vercel protection-bypass
secret scoped to Preview.
