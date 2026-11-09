# Phase 2: call records

- **Status:** implemented and tested on a branch, against disposable databases only.
- **Production:** not migrated. This needs the owner's approval, using the migration proposal below.
- **Telephony:** none. Phone calls will be created by the voice worker (ADR-0005) once that is approved.
- **Branch:** `claude/phase2-call-records`, stacked on `claude/phase2-rate-limiter`. Migration `0011`, after `0010`.

## What a call record is

One row in `calls` per receptionist call, plus an ordered, append-only log in `call_events`.
Utterances, tool calls, hand-offs and errors are all events, so the transcript is the log.
Today calls come from:
- **simulated** calls: the scripted-call harness, or any client testing the agent;
- **web** calls: the Voice lab.

The `phone` channel exists in the schema but cannot be created through the member API. It is
reserved for the worker's service credential.

### Lifecycle

```
POST /calls ──▶ in_progress ──(events: POST /calls/{id}/events, or /live/brain with call_id)──┐
                    │                                                                         │
                    ├── POST /calls/{id}/end ──▶ completed | failed      (once; then 409)     │
                    └── housekeeping, no activity for 2 h ──▶ abandoned                       │
```

- **Rules enforced by the database:**
  - `ended_at` is NULL exactly while `in_progress` (`ck_call_lifecycle`);
  - `ended_at ≥ started_at`;
  - valid channel, status and outcome;
  - `audio_stored = false` (`ck_call_no_audio`).
- **Rules enforced by the API:**
  - no events after the end;
  - a call ends only once;
  - at most 2,000 events per call and 50 per request;
  - event data up to 2,000 characters, text up to 4,000.
- **Ordering:** each append locks the call row. Concurrent writers, such as the brain and a client, get unique, gap-free `seq` numbers. This is tested with 8 parallel writers.
- **Idempotency:** `external_ref` is unique per workspace. Retrying a start returns the same call with status 200.
- **Summary:** computed when the call ends from its events:
  - duration;
  - caller and agent turns;
  - tools used;
  - errors and hand-offs;
  - tokens (uncached, cached, output);
  - the slowest time to first text.

### Live brain integration (simulated-call support)

`POST /live/brain` takes an optional `call_id`.
- **Before anything is spent:** the call must belong to the workspace (otherwise 404) and be in progress (otherwise 409). These checks run before the usage reservation and before any provider call.
- **After the turn:** the stream passes through unchanged. Once it ends, or the listener leaves, the turn is added to the call:
  - the caller's words;
  - each tool (name and success only, never results);
  - any hand-off;
  - the agent's reply, with the turn's metrics;
  - any error.
- **Failure handling:** recording uses its own session and is best effort. A failure is logged and never breaks the caller's turn.

The scripted-call harness now runs every scenario as a simulated call. It checks that the server recorded every caller turn in order, an agent reply per answered turn, numbering from 1 to *n*, and a summary. CI runs this against the stand-in providers.

## Tenant isolation, permissions, audit

| | |
|---|---|
| RLS | Both tables use the standard `tenant_isolation` policy. With no tenant set, the runtime role sees no rows (tested). An event's workspace must equal its call's: composite foreign key `(call_id, organization_id)` |
| Grants | `calls`: SELECT, INSERT, UPDATE, DELETE. `call_events`: **SELECT and INSERT only**, so the transcript is a record. Events go only with their call |
| Start, events, end, brain with `call_id` | `agent_write` (owner and admin), the same as testing the agent today |
| List and read | `read` (every role) |
| Erase a call | `data_export` (owner only) |
| Other workspaces | Get 404 on every call endpoint and in the brain |
| Audit | `call.started`, `call.ended` (status and outcome) and `call.deleted` (channel only). Audit rows never contain transcript text |

## Consent and privacy

- **AI disclosure and recording notice.** Each call records whether the AI disclosure and the recording notice were played.
- **Transcript text is kept only if the recording notice was played** (`transcript_retained`). Otherwise events are stored with their kind, speaker and data, but no words (`data.text_withheld = true`). This is tested at the database level.
- **No audio.** Audio is never stored. The check constraint means a future recording feature needs its own approved migration.
- **Retention.** Each call follows its workspace's `recording_retention_days` (7–365; 90 if a workspace has no settings row). The setting is applied when housekeeping runs, so shortening it also covers existing calls.
- **Erasure.** The owner can delete a single call (an erasure request). Deleting the workspace or account removes everything (`ON DELETE CASCADE`).
- **Export.** The workspace export includes `calls` and `call_events`.

## Retention and abandoned calls

`call_housekeeping(limit)` is a SECURITY DEFINER function that is callable by the runtime role and returns counts only. It:
- deletes calls older than their workspace's retention period, with their events;
- marks in-progress calls with no activity for two hours as `abandoned`.

`scripts/call_housekeeping.py` runs it. Scheduling it in production, as a Vercel cron or GitHub schedule, is a separate approval. Until it is scheduled, nothing is purged automatically.

## API

| Method and path | Purpose |
|---|---|
| `POST /v1/orgs/{org}/calls` | Start a call: `channel` (`simulated` or `web`), `external_ref`, caller number and name, whether the notices were played |
| `POST /v1/orgs/{org}/calls/{id}/events` | Append 1–50 events |
| `POST /v1/orgs/{org}/calls/{id}/end` | End as `completed` or `failed`, with an outcome and reason |
| `GET /v1/orgs/{org}/calls` | List newest first. Filters: `status` and `channel`. Pages with `before` and `limit` |
| `GET /v1/orgs/{org}/calls/{id}` | A call with its events |
| `DELETE /v1/orgs/{org}/calls/{id}` | Erase a call (owner) |
| `POST /v1/orgs/{org}/live/brain` | Now accepts `call_id` |

## Tests

- **`tests/test_calls.py`, 25 tests:**
  - lifecycle, summary and audit;
  - ending once, and no events after the end;
  - idempotent start;
  - the phone channel refused;
  - bad events and oversized data rejected, with nothing partial kept;
  - 8 concurrent writers producing gap-free sequence numbers;
  - list filters and paging;
  - consent: no words stored without the notice, and audio can never be marked stored;
  - roles;
  - cross-workspace 404s;
  - an event cannot point at another workspace's call (database foreign key);
  - RLS with no tenant, and events append-only;
  - erasure with nothing left behind, and no transcript in the audit log;
  - export;
  - housekeeping per-workspace retention, and abandonment;
  - housekeeping's limit validation;
  - workspace deletion cascades;
  - the 0011 round trip;
  - brain turns recorded into the call, including tool and metrics;
  - the brain refusing an ended or foreign call before any provider request.
- **Harness:** `tests/test_voice_harness.py` checks the harness's call-record checks. Run locally against a live API and the stand-ins, all 7 scenarios and 9 turns were recorded completely.
- **Release verifier:** for 0011 or later, the tables exist, `ck_call_no_audio` exists, and the runtime role has no UPDATE or DELETE on `call_events`.
- **Full API suite:** 324 passed.
- **Migration rehearsal:** see `docs/phase-2-migration-rehearsal.md`. A local production-shaped clone went 0009 → 0011 → 0009 → 0011 with 350 checks passing and row counts unchanged.

## Migration proposal (needs owner approval)

| | |
|---|---|
| Change | Adds two tables (`calls`, `call_events`), their RLS policies and grants, and the function `call_housekeeping`. No existing table is touched |
| Data | None migrated. Both tables start empty |
| Lock impact | `CREATE` only, with no lock on existing tables |
| Order | After 0010. **Migrate first, then merge** (the build preflight refuses code that is ahead of the schema) |
| Steps | 1. Neon backup branch. 2. `db-migrate` to `0011` (0010 and 0011 can run in one approved upgrade). 3. `verify_release.py --expect 0011 --baseline …`. 4. Merge. 5. Confirm the preflight reports "schema at 0011". 6. Smoke test: start a simulated call, add an event, end it, read it back, delete it |
| Rollback, code | Revert the merge. The tables are unused but harmless |
| Rollback, schema | `alembic downgrade 0010` drops both tables and the function (tested). **This deletes any call records.** Take an export first if any matter |

## Not in this change

- **Phone calls.** These need the worker's service credential and the phone-number-to-workspace mapping (ADR-0005), with a migration approved separately.
- **A web view of call records.** The API is ready; the Voice lab and dashboard do not use it yet.
- **Scheduling housekeeping** in production.
- **Redaction of card numbers or health details within transcripts.** Recommended before real callers.
