# RC-1 release review — 5 November 2026

RC-1 remains pending API deployment and acceptance. Canonical completion phases are
0–10 from the owner's master roadmap; the older README phase labels are historical.

## Verified release state

- Production branch `claude/confident-shannon-7nb05f` is at
  `9f6633573e4d260e138427a2e09f7a9e919582ef` (PR #1 and PR #3 merged).
- Owner-approved [claim run 41971155929](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/41971155929)
  completed at 10:30 IST on 5 November. Its log reports runtime-role compatibility,
  schema 0006 → 0007 and the production marker. A subsequent read-only Neon query
  independently confirmed schema 0007 and marker `production`.
- Recovery branch `backup-pre-claim-20261105-0440Z` exists. No restore drill is claimed.
- Production API alias still points to `dpl_EEBqGurCwGj7mWkhzWNGQSo4JWiA`, source
  `767c0f2bfc54db4da16220a37cc87b66f12b4b8d`. Flow serves source 9f663357.
- Post-claim GET `/healthz` returned `{"status":"ok"}` and `/readyz` returned
  `{"status":"ready"}`. This does not establish session or workflow acceptance.
- Shared staging serves `94dae660d50fc356a53a48f43e2fcd63807e2377`, schema 0008,
  marker `staging`. It is not an RC-1 source/schema rehearsal.

Do not repeat the production claim or downgrade shared staging to fit RC-1.

## Migration failure confidentiality

Role DDL embeds a derived runtime password. A SQLAlchemy exception can include
that statement, and connection/configuration errors can contain an owner URL.
The CLI now returns failure with a fixed message after exceptions unwind the
transaction. It does not render exception text, causes or tracebacks.

Four subprocess regression cases inject credential-bearing SQLAlchemy errors at
connection creation, after role DDL, after schema migration and after marker
insertion. They check a nonzero exit, no credential/statement output, unchanged
runtime-role login and rollback of schema/claim writes on disposable CI PostgreSQL.
They never connect to hosted databases. Successful migrations, approval checks,
advisory locking, host confirmation and role compatibility policy are unchanged.

On failure, inspect a read-only state check and infrastructure availability before
retrying. The fixed failure message does not claim that a commit with an uncertain
network outcome was rolled back. Do not enable SQL echo or print caught exceptions.

## Exact next production proposal — approval required

The proposed release is **only voxera-api**, from reviewed commit
`9f6633573e4d260e138427a2e09f7a9e919582ef`. Do not rebuild the old 767c0f2 source.
The migration-log safeguard can be reviewed independently; it is not a new
production migration or an authorization to merge this branch.

Before deployment:

1. Confirm current branch, source, production database identity/schema and no
   pending RC-1 migrations through authorized read-only checks.
2. Retain the existing healthy API deployment and the pre-claim recovery branch.
3. Confirm `VOXERA_JWT_SECRET` remains Production-only and Sensitive. Do not
   expose, rotate or derive it from a database password.
4. Obtain owner approval for this exact API deployment and the scope of synthetic
   acceptance data. GitHub required reviewers and owner release gates remain in force.

After approved deployment, verify Vercel's source identity and health/readiness
before any acceptance writes. Use clearly identified synthetic accounts and
workspaces only for authorized auth/session, onboarding, persisted configuration,
booking/change/cancellation, staff permissions and cross-tenant denial checks.
Record expected/actual outcomes, request IDs and redacted errors. Never use real
customer records as fixtures. Rescheduling limitations remain an explicit gate.

Stop on schema/identity mismatch, authentication regression, cross-tenant access,
unexplained integrity errors or missing evidence. A green build alone cannot
complete Phase 1 or establish commercial readiness.

## Recovery

If an approved release regresses, propose Vercel Instant Rollback to the retained
healthy deployment. The older source's build can run migrations, so rebuilding it
is not an equivalent recovery procedure. Retain additive schema 0007 unless a
separate database rollback is reviewed and approved. Credential rotation, database
downgrade, restore and synthetic-account deletion each retain the owner's approval
requirements. A restore must account for customer writes after the recovery point.

## Remaining development gates

- PR #2 remains open at b3edbe26 and targets the old PR #1 branch. Integration must
  preserve PR #3 and be tested against the release branch before merge approval.
- Studio browser diagnostic strings previously counted as passes; corrected result
  classification and browser reruns are needed before accepting its test evidence.
- Preview and Development share staging; their interference risk remains open.
- Historical credential exposure, exports, atomic rescheduling, voice listening,
  telephony, integration and billing acceptance remain separate roadmap work.
- The autonomous development orchestrator is not running. Its implementation and
  supervised Phase 2 pilot remain dependent on Phase 1 acceptance.
