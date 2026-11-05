# Atomic appointment rescheduling

Moving an upcoming booking now updates its existing row. Its reference, customer,
source, creation time and idempotency key remain attached to the booking. The move
may overlap the booking's previous time because capacity checks exclude that row.
Other bookings and buffers still count.

`POST /v1/orgs/{org_id}/appointments/{appointment_id}/reschedule` accepts
`{"starts_at":"<ISO datetime>"}` and returns the existing `AppointmentOut` shape.
The existing `calls_manage` permission and tenant checks apply. Unavailable slots
and invalid business times return 409 without changing the original appointment;
an inaccessible appointment returns 404. Viewers cannot move bookings.

The shared service takes the same transaction-scoped workspace lock used by new
bookings, refreshes the appointment under a row lock, checks active/upcoming state,
service policy, lead time, horizon, quarter-hour alignment, business hours and
capacity, then updates the row. The caller records an audit event and commits both
together. The shared service returns `(appointment, previous_start)` so the audit
uses the value read under the lock. AI moves still require caller confirmation.

The staff desk offers a Reschedule form with available times labelled in the
business time zone and an explicit Confirm move action. Its availability request
passes the current appointment ID; the server validates its workspace and service
before excluding it. Every mutation revalidates availability. Errors remain
visible, busy controls prevent duplicate submissions, and cancellation asks for
confirmation and reports failures.

## Verification and operating implications

PostgreSQL tests cover overlapping moves, retries, unchanged references, conflicts,
business-time validation, offset conversion, cancelled/inactive services, viewer
and tenant denials, rollback when auditing fails, two competing moves, competing
booking versus move and AI confirmation. Browser checks cover a displayed conflict
followed by a successful move with the same reference, plus declined cancellation.
The browser conflict is a deterministic HTTP fixture; database conflict/race tests
use real disposable CI PostgreSQL. CI uses fake model providers and no paid calls.

No migration is required: the existing API role already has UPDATE permission on
appointments. No hosted customer data is used by these tests. Test results belong
to their exact commit and must be recorded before calling this change accepted.

Deploy only after release approval and frontend/API compatibility checks. Rollback
uses a reviewed prior deployment; it does not recreate cancelled replacement rows
from older rescheduling behavior. No historical records are rewritten. This change
does not complete staff shifts, holidays, multi-location capacity, reminder
integrations or the remaining Phase 2 acceptance requirements.
