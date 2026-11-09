# Phase 3 — Workspace voice policy and telephone numbers (migration 0012)

**Status:** draft. Not migrated on shared staging or production. Nothing here enables telephony,
a speech provider or a paid service.

## What it adds

| Piece | What it does |
|---|---|
| `voice_policies` (one row per workspace) | The languages the receptionist may speak, the default and fallback language, the regions where providers may process data, blocked and preferred providers, and whether paid or unverified providers may be used. No row means the defaults in `app/voice/routing.VoicePolicy`. |
| `phone_numbers` | Telephone numbers (E.164) that reach a workspace. A number belongs to **at most one** workspace. Status `active` or `disabled`. |
| `GET/PUT /v1/orgs/{org}/voice/policy` | Everyone in the workspace reads it; owners and admins (`business_write`) change it. Validated exactly as routing uses it. Every change is audited with the names of the changed fields. |
| `GET /v1/orgs/{org}/voice/route?language=` | The route a call would take under the **saved** policy. Calls nothing. |
| `GET /v1/orgs/{org}/voice/numbers` | The workspace's own numbers. Read-only. |
| `GET /v1/worker/voice/policy` | The voice worker reads its token's workspace policy. Replaces the `VOXERA_LANGUAGES` environment variable. |
| `scripts/phone_numbers.py` | Operator-only `assign`, `disable`, `enable`, `list`, `resolve`, using the owner connection. `--env` must match the environment the database is claimed for. |

## Security decisions

- **No workspace can claim a number.** The runtime role has `SELECT` only on `phone_numbers`
  (and row-level security limits that to its own workspace). Numbers are assigned by an operator
  with the owner connection. Reassigning a number means disabling it and assigning it again in a
  reviewed change.
- **The dialled number gates telephone call records.** `POST /v1/worker/calls` with a phone token
  must include `called_number`, and the number must be active for the token's workspace. A missing,
  disabled, unknown or other workspace's number all get the same 403, so nothing reveals who owns a
  number. Simulated calls may not send a dialled number.
- **The worker fails closed.** It reads the saved policy before opening a call record; if the policy
  cannot be read or is malformed, the call is refused. For a SIP participant it sends the dialled
  number from the LiveKit attribute `sip.trunkPhoneNumber` (normalised to E.164); if the API refuses,
  the call is not answered.
- The existing gates still apply: a live token only for a launch-ready country, SIP disabled unless
  `VOXERA_SIP_ENABLED=true`, speech media disabled unless explicitly configured.

## Rollout (each step needs the owner's approval)

1. Merge only after migrating: the build preflight refuses code whose migration head differs from
   the database, so production must be migrated to 0012 and this PR merged back to back (as with
   0010 and 0011).
2. Back up, then migrate shared staging and production to 0012.
3. Before any real telephone call: assign the number with `scripts/phone_numbers.py`, and set the
   workspace's policy.

Rollback before any number or policy is saved: `downgrade 0011` drops both tables. After data exists,
downgrading deletes the saved policies and number assignments.
