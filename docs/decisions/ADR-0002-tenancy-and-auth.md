# ADR-0002: Tenant isolation with app-level scoping plus Postgres row-level security; first-party auth

- **Status:** Accepted (Phase 2)
- **Date:** 2026-10-25

## Context
VOXERA stores call transcripts, customer details and business configuration for many independent businesses. A single missed `WHERE organization_id = …` must not expose one business's data to another.

## Decision
**Tenancy — shared database, shared schema, `organization_id` on every tenant row, enforced twice:**
1. Application: every tenant route resolves an `OrgContext` (membership check → 404 for non-members) and filters by `organization_id`.
2. Database: row-level security policies compare `organization_id` with the transaction-local setting `app.org_id`. The API connects as `voxera_app`, which owns no tables, so policies always apply. Settings are applied with `set_config(…, true)` at the start of every transaction (SQLAlchemy `after_begin`), so they cannot leak across pooled connections.
- The audit log is append-only: `voxera_app` has INSERT/SELECT only, and an UPDATE trigger rejects edits even by the owner. Usage events are insert-only for the same reason.
- Migrations run as `voxera_owner`; the runtime never holds DDL rights.

**Auth — first-party, standards-based:**
- argon2id password hashing; generic login errors; per-email+IP login rate limit.
- 15-minute HS256 JWT access tokens bound to a server-side session (revocation is immediate).
- Opaque, single-use refresh tokens stored as SHA-256 digests; rotation on every refresh; reuse of an old token revokes the whole session (theft detection).
- Invitation tokens are opaque, hashed, single-use, expiring and bound to the invitee's email.

## Consequences
- ✅ Isolation failures need two independent bugs; the RLS layer is tested directly with SQL.
- ✅ Simple to operate (one database) and cheap at small scale.
- ⚠️ Every new tenant table needs a migration adding its RLS policy and grants — checked by `test_rls_returns_nothing_without_tenant_context`; extend that list for new tables.
- ⚠️ Login rate limiting is in-process; must move to a shared store before running multiple API instances (Phase 13).
- ⚠️ No MFA/SSO yet; SSO (OIDC) and TOTP are candidates once real customers are onboarded.

## Alternatives considered
- **Database-per-tenant:** strongest isolation, but heavy operational cost for small salons. Revisit for enterprise customers.
- **Managed auth (Auth0/Clerk/Supabase):** faster SSO/MFA, but adds per-MAU cost and a third party holding identity data; kept as an option behind the same session contract.
