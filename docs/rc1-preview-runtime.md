# RC-1 restricted Preview remediation

Base: c615205ab5e77609d0d70509bc6f42f19dc2b78f. This change does not claim or migrate a database.

The failed Preview read schema 0008 while the candidate requires 0007. Do not
change shared staging to accommodate this release. The dedicated RC-1 database
was verified read-only as staging/0007 using voxera_app on 6 November 2026.
That role now has SELECT access to alembic_version, and is neither superuser nor
BYPASSRLS. The earlier missing SELECT permission is no longer a blocker.

## Configuration gate

Only Preview branch codex/rc1-validation may use this profile. Require:

- VOXERA_DEPLOYMENT_PROFILE=rc1-validation
- VOXERA_EXPECT_DB_ENV=staging
- VOXERA_DATABASE_URL: dedicated pooled/direct URL as voxera_app, database neondb, TLS
- VOXERA_BUILD_DATABASE_URL: dedicated direct URL as voxera_app, database neondb, TLS
- VOXERA_JWT_SECRET: independent random secret, at least 32 characters

Exact direct host: ep-wandering-hat-zatfukuw.c-2.eu-west-2.aws.neon.tech.
No owner credentials belong in this Preview. All LEGACY_KEYS in rc1_preview.py
must be absent or empty in the effective deployment environment. Branch-specific
masking must be verified before deployment; changing global shared staging settings
is outside this remediation. No migration URL override is accepted. The build reads
identity and schema in a read-only transaction; runtime configuration uses the same
validated restricted endpoint. Migration owner lookup refuses in this profile.

## Verification and release gates

Run: `cd services/api && uv run python -m unittest discover -s tests -p 'test_rc1_*.py' -v`.
The tests use mocks and synthetic URLs only, not customer records or paid providers.
They are configuration/build regression evidence, not hosted acceptance evidence.

Before hosted tests: review and incorporate this change into the protected validation
branch, configure branch-specific restricted credentials and JWT, neutralize inherited
database aliases, verify deployed commit/endpoint/marker/schema, and verify the frontend
targets that exact API. Do not send synthetic writes until these identities are proven.
Authentication, tenant boundaries, scheduling concurrency and browser acceptance remain
blocked until that isolated deployment exists. Production and shared staging behavior
are unchanged unless an RC-1 profile is incorrectly attached, in which case it refuses.

## Recovery

On any mismatch stop before deployment or hosted writes. Do not retry claims or migrations.
Retain the failed Preview as evidence. Revert this PR on the nonproduction branch if needed;
do not promote an older deployment carrying inherited database credentials. Configuration
rollback must not reintroduce owner or shared staging credentials. No production rollback
or database restoration is part of this work.
