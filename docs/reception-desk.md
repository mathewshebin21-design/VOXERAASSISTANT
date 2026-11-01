# Receptionist intelligence, the staff desk, and dashboards by business type

## How the receptionist behaves (live Claude brain)
`services/api/app/live/receptionist.py` holds the prompt and tools.
- **Manner:** calm, warm and patient.
  - Short spoken sentences in British English, and one question at a time.
  - It acknowledges what it heard, reassures callers who are unsure, and rephrases more simply when someone is confused.
  - Times, prices and phone numbers are said the way people say them. It never guesses a name, number or time.
- **What it can do**, using tools over the workspace's own data:

  | Tool | Purpose |
  |---|---|
  | `get_business_info` | Business details |
  | `get_opening_hours` | Opening hours |
  | `list_services` | Services and prices |
  | `check_availability` | Real free slots |
  | `book_appointment` | Book |
  | `find_my_appointments` | Find the caller's own bookings |
  | `reschedule_appointment` | Move one of them |
  | `cancel_appointment` | Cancel one of them |
  | `take_message` | Leave a message for the team |
  | `transfer_to_staff` | Hand over to a person |

- **Consent is checked on the server.** Booking, moving or cancelling runs only if the caller's latest reply is a clear yes, with no hedging and not a question. Otherwise the tool refuses and the agent reads the details back again.
- **Callers can only act on their own bookings.** They are found by the caller's phone number, and nobody else's are revealed or changed.
- **Facts come only from tools.** If something isn't known, the agent says so, then offers the team.
- **Hand-over:** when the caller asks for a person, the request is outside what it can do or know, there is a complaint, payment or other sensitive matter, the caller is frustrated, or a tool keeps failing:
  - it tells the caller what's happening;
  - it passes a summary, so the caller doesn't repeat themselves.
- **Free demo receptionist (rule-based):** it now offers to put the caller through when it can't answer, and transfers on a yes.

## Booking engine (`app/reception.py`)
- **Availability** comes from:
  - opening hours, in the workspace time zone;
  - the service's duration, plus its buffer (clean-up time);
  - existing bookings;
  - **booking capacity**: how many clients can be seen at once, set in Workspace → Settings.
- **Booking rules:**
  - at least one hour of notice, and at most 60 days ahead;
  - start times on the quarter hour;
  - a per-workspace database lock, so the last slot can never be given to two callers.
- **AI bookings are idempotent per call.**

## The staff desk: several employees at once (`/flow/app/desk`)
- **Who can use it:** each employee sets themselves **Available**, **Busy** or **Offline**. The new **Staff (front desk)** role can work the desk and manage bookings, but can't change business settings. Owners, admins and managers can work it too; viewers can't.
- **Where a transfer goes:**
  - **Open, and someone is available:** to the available person with the fewest open cases, then whoever has waited longest. They're marked busy, because they're on the call.
  - **Open, but everyone is busy:** into the shared queue for the next free person to call back.
  - **Closed:** a callback request.

  A per-workspace lock means two simultaneous transfers never land on the same person.
- **Shared queue:**
  - **Take it** claims a case atomically. If a colleague got there first, you see "Sam has already taken this case".
  - Cases can be reassigned or put back in the queue.
  - **Notes** are append-only.
  - **Resolve** with how it was solved, or **reopen**. Resolving a transferred call puts the employee back to available.
- **Bookings panel:** upcoming bookings, cancel, and a "New" form that only offers free slots.
- **Live updates:** the page refreshes every 5 seconds, so everyone on the desk sees the same state. Telephony (Phase 4) will ring the assigned person's phone or `transfer_phone`.

## Dashboard by business type (Pulse)
Choose from: Salon & beauty · Clinic & therapy · Trades & home services · Restaurant & hospitality · Professional services · Gym & fitness · General.
- **What changes:**
  - the wording: appointments, jobs, reservations, consultations or sessions; clients, patients, customers, guests or members;
  - which panels lead;
  - the headline figures: e.g. out-of-hours calls for trades, unhappy callers for clinics, busiest hours for restaurants.
- **Where it's saved:** for a signed-in workspace, the choice is stored as the business **sector**, which is also editable in Workspace → Profile. In demo mode it's remembered on the device.
- **The numbers:** figures are still the demo salon's synthetic records until live call records exist (Phase 4).

## Verification (2026-11-01)
- **API: 102 tests.**
  - Availability, buffer and capacity; double-booking refused.
  - Least-busy routing, and the second transfer going to the other person.
  - Queued when everyone is busy; callback when closed.
  - Claim race returns 409; notes are append-only for the database role.
  - Resolving frees the employee.
  - Consent detection (13 cases); AI bookings only after a yes, and idempotent on retry.
  - A caller can't see or cancel someone else's booking.
  - Tenant isolation, and the staff role's permissions.
- **Browser, demo: 127/127.** Includes the Desk route and the dashboard picker.
- **Browser, live: 26/26,** against the API, Postgres and the fake providers:
  - an available employee receives an AI transfer, adds a note and resolves it, and is set back to available;
  - booking from the Desk;
  - the dashboard type is saved to the workspace.
- **Not verified:**
  - the real Claude model's conversational behaviour (no API key here);
  - real phone transfers (Phase 4).
