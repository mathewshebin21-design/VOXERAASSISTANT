# Phase 1: rescheduling. Implementation specification and tests

**Status: specification only. No code has been changed.** Implementation needs the owner's approval and runs on its own branch after PR #2 merges.
Roadmap placement: the tracker's Phase 1 (core product) row "Rescheduling 🟡". The roadmap phases themselves aren't renumbered or replaced.

## 1. What exists today (verified in code, `claude/agent-studio` at `359aa31`)
| Path | Today |
|---|---|
| `reception.reschedule()` | Books a **new** appointment, then cancels the old one |
| AI receptionist (Claude or another provider; needs a paid key) | Has a `reschedule_appointment` tool that calls the helper above. It needs a confirmed "yes" (`_need_yes`) and an owned booking reference (`owned_appointment`) |
| REST API | **No reschedule endpoint.** Only create and cancel |
| Staff desk page | **No move action.** Only list, book and cancel |
| Agent Studio engine (deterministic, free) | The `reschedule_appointment` tool **always fails** ("not available in flows yet: route to Escalate") |
| Tests | Only a negative test (`test_live_hardening.py`: refused without confirmation). **No test of a successful move** |

**Defects in the current helper:**
1. **A booking blocks itself.** The new slot is checked while the original booking still holds capacity. Moving a 30-minute appointment by 15 minutes at capacity 1 is refused as "slot just taken".
2. **The booking reference changes.** The caller's reference no longer finds their booking.
3. **Moves look like cancellations.** The old booking ends up `cancelled`, so insights and exports count a move as a cancellation.

## 2. Design
**Move the booking in place: same row, same id, same reference.** No schema change is needed. History goes in the audit log.

### 2.1 Core: `app/reception.py`
- Extract the slot checks from `book()` into `_check_slot(db, d, svc, start_local, now, source)`:
  - agent-bookable;
  - the 1 h lead time;
  - the 60-day horizon;
  - the quarter hour;
  - within opening hours (`_fits`).

  `book()` calls it. Its behaviour doesn't change; the existing tests guard that.
- Replace `reschedule(db, d, a, new_start_local, *, source, now=None) -> tuple[Appointment, bool]` (`bool` = changed). It refuses with `DeskError` when:
  - `a.status != booked`: "That booking has been cancelled.";
  - `a.starts_at <= now`: "That appointment has already started or passed.";
  - its service was deleted or made inactive: "That service is no longer offered, so the team will need to rebook it.".

  Then, in order:
  1. Normalise a naive `new_start_local` to the workspace time zone. If it equals `a.starts_at`, return `(a, False)`, a no-op.
  2. Run `_check_slot` for the new time, using the service's **current** length and buffer.
  3. Take the same per-workspace advisory lock as `book()` (`bookings:{org_id}`). Re-read `a` `FOR UPDATE` and repeat the status check, so a concurrent cancel wins cleanly.
  4. Check capacity with `_booked(...)` **excluding `a.id`**.
  5. Update `starts_at`, `ends_at` and `blocks_until` in place, then `flush()`.
- `_booked()` gains an optional `exclude: uuid.UUID | None`.

### 2.2 REST API: `app/routers/desk.py`
- `POST /v1/orgs/{org_id}/appointments/{appointment_id}/reschedule`, needing `Perm.calls_manage` (the same as create and cancel).
- Body `RescheduleIn(Strict)`: `starts_at: datetime` ("Local or offset time; naive times are taken in the workspace time zone").
- 200 → `AppointmentOut` (same id). 404 if the appointment isn't in this workspace; row-level security also hides it. 409 → `{"detail": <DeskError text>}` for slot, lead, horizon, hours, cancelled or past. 422 for validation.
- Audit `appointment.rescheduled`: `{"from": <old ISO>, "to": <new ISO>, "by": "staff"}`, actor = user. A no-op writes no audit row.

### 2.3 AI receptionist: `app/live/receptionist.py`
- Switch to the new helper. The tool result returns `moved_to` with the **same reference**.
- Audit `{"from","to","by":"ai_receptionist"}`.
- Keep `_need_yes` and `owned_appointment` unchanged.

### 2.4 Agent Studio engine: `app/flows/engine.py`
- Implement `reschedule_appointment` in `_tool`:
  - **needs:** the caller's phone; one owned upcoming booking (reference variable `appointment_ref`, or exactly one upcoming booking for that phone); a new time in the variable `new_start` (set by an availability/time choice node);
  - **outcomes:** `success`, or `failure` with the `DeskError` text spoken.
- **Dry run:** validate inside the existing rolled-back savepoint, so nothing is saved. Live mode commits through the same helper.
- The Testing Lab's **12 standard scenarios stay as they are**, so existing agents' publish gates don't change. Add an optional template scenario, "Move my booking", that owners can add to their suite.

### 2.5 Staff desk UI: `apps/previews/src/app/flow/app/desk/page.tsx`
- A **Move** action on each upcoming booking. It opens the slot picker already used for new bookings, filled with that service.
- Confirm → `POST …/reschedule`. On 409, show the reason and reload the slots.
- Flow's calendar page stays demo data (a separate roadmap item).

### Not in scope
- Changing the service during a move.
- Notifying the customer (no email or SMS provider is approved).
- Per-staff diaries.

## 3. Acceptance tests
**API, pytest, real Postgres (`tests/test_reschedule.py`)**
1. **A move keeps the identity:** same id and reference, status `booked`, new start, end and buffer; the old slot becomes free.
2. **Moving into an overlapping slot of its own works** (the regression for defect 1): capacity 1, 10:00–10:30 → 10:15 succeeds.
3. **A slot taken by another booking is refused** with 409, and the original is unchanged.
4. **The capacity rule holds:** with capacity 2 and two other bookings at the target, the move is refused; with one, it's accepted.
5. Lead time, horizon, quarter hour and opening hours are each refused with 409, and the original is unchanged.
6. A cancelled booking, a past booking, or a deleted or inactive service → 409.
7. **The same time is a no-op:** 200, no audit row.
8. **Concurrency:** two simultaneous moves of different bookings into the last free slot → exactly one succeeds. A move racing a cancel never moves a cancelled booking.
9. **Tenant isolation:** another workspace's appointment id → 404 through the API, and invisible under row-level security.
10. **Roles:** owner, admin, manager and staff can move (`calls_manage`); a viewer → 403.
11. **Audit:** `appointment.rescheduled` with from/to and the actor.
12. **Time zones:** a naive time is read in the workspace zone, an offset time is respected, and a move across the British Summer Time change keeps the local time.
13. **Data export** shows one booking, not one cancelled plus one new.

**AI receptionist (fake provider)**

14. A move with a confirmed "yes" → the same reference, `moved_to` returned. Without confirmation → refused (the existing test stays).

**Agent Studio engine**

15. The flow path "move my booking" → success in a dry run; nothing is saved (counts before = after).
16. Live mode moves the booking; the slot is taken → `failure` with a spoken reason.
17. **The existing 12 standard scenarios** and every existing `test_flow_*` test pass unchanged.

**Browser (`e2e-live.mjs`)**

18. Desk: book → Move → pick a slot → the list shows the new time with the same reference; a slot taken in another tab → the error is shown and nothing changes.

**Gate:** the full API suite, web unit tests, all browser suites and the staging run are green before any production step.

## 4. Release notes
- **No migration needed**, so production schema 0008 is unchanged. This can ship as a normal deployment after RC-2.
- **Risk:** it changes shared booking code (`book()` refactor). This is covered by the existing booking, receptionist and engine tests plus the tests above.
- **Estimate:** about 1–1.5 days of implementation and tests.
