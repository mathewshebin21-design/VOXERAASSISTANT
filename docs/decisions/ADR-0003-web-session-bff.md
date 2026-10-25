# ADR-0003: Browser sessions through a Next.js backend-for-frontend

- **Status:** Accepted (Phase 2, front-end integration)
- **Date:** 2026-10-25

## Context
The Flow front end must call the multi-tenant API. Storing API tokens in `localStorage` would let any XSS bug steal a long-lived refresh token.

## Decision
- The browser talks only to same-origin Next.js route handlers:
  - `POST /api/session/{signup|login|logout}` and `GET /api/session/me`
  - `/api/v1/*` — an allow-listed proxy to the API (`me`, `orgs/**`, `invitations/accept`; auth endpoints are not proxied).
- Tokens live in **httpOnly** cookies: access token (`SameSite=Lax`, 15 min) and refresh token (`SameSite=Strict`, path `/api`, 30 days). `Secure` in production.
- **CSRF:** every mutating request must carry `x-voxera-csrf: 1` (unsendable cross-site without a CORS preflight, which these routes never grant) and, when present, a matching `Origin`.
- **Refresh:** on a 401 the proxy refreshes once and retries. Concurrent refreshes of the same token share one in-flight request, because the API revokes a session when a rotated refresh token is reused.
- Signed-out is a normal state: `/api/session/me` returns `{ user: null }` with 200.

## Consequences
- ✅ Page scripts cannot read tokens (verified by the live E2E test); CSRF is blocked (verified).
- ✅ The API stays a pure Bearer-token API, usable by future mobile apps or integrations.
- ⚠️ Refresh de-duplication is per Next.js process. With several web instances, add sticky sessions or move the de-duplication to a shared store, otherwise a rare race could revoke a session (the user simply signs in again).
- ⚠️ Demo-backed pages (calls, live, insights, calendar, knowledge, simulator, canvas) still use synthetic data until Phases 3–7 add their tables; they display a notice when a real workspace is signed in.
