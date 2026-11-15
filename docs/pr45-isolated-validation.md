# PR45 isolated hosted validation — 16 November 2026 (India)

## Authorization and verified resource
The owner approved one isolated staging branch with 0.25 CU fixed compute and 300-second idle suspension. Production changes, paid voice activation and external customer actions remain gated. No existing branch or backup may be deleted.

| Item | Verified value |
| --- | --- |
| Neon project | blue-night-16595257 (voxera-staging) |
| Parent | br-super-cake-za8v2xbj |
| Validation branch | br-shy-math-zaczmtq5 |
| Branch name | pr45-validation-0012-20261116 |
| Endpoint | ep-falling-darkness-zaoogbut |
| Host | ep-falling-darkness-zaoogbut.c-2.eu-west-2.aws.neon.tech |
| Database | neondb |
| Initial schema / environment | 0011 / staging |
| Compute | min=max 0.25 CU; idle suspension 300 seconds |
| Application source tested by migration | 102bf2cd13bdc8915503a7f0a59708f161f128e5 |

This clone contains existing staging data, not production data. Its usage may incur charges under the existing Neon plan. Endpoint settings and initial database revision were independently read back after creation.

## State
- Branch creation and initial read-only identity verification: completed.
- Target guard: six local unittest methods passed, including wrong host/source/environment identifiers, invalid ports, SSL downgrade, duplicated connection parameters and libpq destination overrides.
- Protected GitHub environment, credentials and branch-only Preview configuration: pending.
- Migration 0012: **not run**.
- Hosted acceptance and real audio acceptance: **not run**.
- Production rollout: **not authorized**.

The GitHub connector cannot manage environment secrets/settings. Browser connection attempts currently fail before a tab can be selected (timeoutMs error). Local GitHub access fails DNS resolution; the workstation has approximately 140 MiB available. No credentials were printed, no migration request file was created, and no migration is scheduled.

## Setup to complete after browser access is restored
1. Create GitHub environment `pr45-isolated-validation`, restricting deployment to `codex/uk-india-release-candidate-20261116`. Verify protections before storing credentials.
2. Set environment variables `VALIDATION_PROJECT_ID=blue-night-16595257` and `VALIDATION_BRANCH_ID=br-shy-math-zaczmtq5`.
3. Configure `PR45_ISOLATED_DATABASE_URL_UNPOOLED` and `PR45_ISOLATED_DATABASE_URL` as protected environment secrets from this clone only. Never place URLs/passwords in code, issues, PR bodies, request files or chat. Ensure independent Preview credentials/JWT before exposing a Preview. Any runtime credential mismatch must remain a hard stop; the prepared workflow does not reset roles.
4. Recheck source and database identity. Only after setup is verified, create `.github/rehearsal/pr45-isolated-migrate.request` containing exactly the application source SHA above. This starts the isolated migration workflow. There is no production, downgrade or reset option.
5. Retain baseline counts; run the pinned source's migration script and verify schema 0012, runtime privileges, tenant isolation and unchanged baseline counts. Re-read the parent and production revisions separately.
6. Configure API and Flow Preview settings for this candidate branch only; keep media/provider gates off. Verify the deployed application SHA and database identity before synthetic writes.
7. Run hosted auth/session, tenant/RBAC, booking, voice policy/number ownership, call-history/consent and frontend checks. Record evidence and recheck isolation. Do not mark the phase complete on CI alone.

The migration gate accepts only this clone's direct host and, for the runtime connection, its corresponding pooled host. It rejects arbitrary libpq query parameters that could redirect a nominally valid URL elsewhere. Tests use synthetic credentials only.
