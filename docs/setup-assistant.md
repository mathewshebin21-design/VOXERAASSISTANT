# Setup assistant

A built-in assistant that sets a workspace up by conversation. It lives at **`/flow/app/setup`**, with a "Setup" item in Flow's navigation. A signed-in workspace's Pulse page offers it until setup is complete, and every setup step on Command's and Atelier's dashboards opens it.

## Two modes
| Mode | When | How it works |
|---|---|---|
| **Step by step (free)** | Always available | Asks one question at a time: business type, phone, address, opening hours, services, capacity, receptionist name. Understands everyday answers (`src/lib/setup/parse.ts`), e.g. "Tue–Sat 9–5:30, Sun and Mon closed" or "Women's cut, 60 min, £45". Shows its interpretation, including assumptions and anything it couldn't read, and only saves hours and services after a "yes". Each answer is saved immediately through the normal API. "Skip" defers a step; steps already done are skipped. |
| **Claude** | When the server has a Claude key and a non-zero monthly cap (`GET …/live/setup-assistant/status`) | Free-form chat with a server-side agent (`services/api/app/live/setup_agent.py`). It has six tools: read the setup state, update business details, set opening hours, add services, set capacity, create the receptionist. Each tool validates with the same schemas as the REST API, is audited with `via: setup_assistant`, and is limited to the workspace by row-level security. The receptionist's greeting must disclose that it's an AI. Token use counts towards the same monthly caps as the live receptionist. |

Only owners and admins can run it, because it changes business settings and creates the receptionist.

## Real data on Flow's Pulse
- When you're signed in, Flow's Pulse now shows the workspace's real data rather than the demo salon:
  - bookings, in the workspace's time zone;
  - the desk queue and who's available;
  - a setup card;
  - honest "no calls yet" messages.
- The business-type picker still sets the wording (appointments, jobs, reservations…).
- **Explore with demo data** is in the workspace menu and on Pulse, as a separate, labelled mode, with "Back to my workspace".

## Business templates

Some business types come with a ready-made starting point. In step-by-step mode, once the business type is set, say “template” at the **Opening hours** or **Services** step. The assistant shows the whole template first and saves only after a yes. Every part can be edited in Workspace afterwards.

**Barbershop** (`barbershop` sector, uses the Salon dashboard), defined in `apps/previews/src/lib/setup/templates.ts`:

- **29 services** in four categories (Haircuts, Beard & shaving, Combos, Extras), each with a length, a 5-minute clean-down buffer (none for quick add-ons) and a "from" price at typical UK high-street rates for 2026. Examples: classic cut 30 min from £20, skin fade 45 min from £24, cut and beard 50 min from £30, hot towel shave 40 min from £22.
- **Hours:** Mon–Fri 09:00–19:00 (Thu until 20:00), Sat 08:30–17:00, Sun 10:00–16:00.
- **Booking policies** saved to the business description, which the receptionist reads when callers ask questions: walk-ins, 10-minute late grace, 24-hour cancellation, deposits, payment, kids, reference photos and products. Anything it doesn't cover (parking, accessibility) becomes a message for the team. If the business already has a description, it is left alone.

"Barber" or "barbers" in the business-type answer now selects Barbershop instead of Hair & beauty. The Claude setup agent accepts the new sector too, but only the step-by-step mode offers the template.

## Verification (2026-11-01)
- **Unit tests: 97.**
  - 34 for the parsers: days, time ranges ("9-5", "1-5pm", "9 to noon"), weekly hours with overrides and closed days, services ("1h30", "3 hours", "£75.50", patch test), UK phone and postcode, business type, yes and skip.
  - 7 for the guided conversation.
- **API tests: 107.** The 5 new ones cover each setup tool:
  - business details merge, with validation, and a bad phone number changes nothing;
  - hours replace the week, and bad hours change nothing;
  - services skip duplicates and convert prices;
  - capacity limits;
  - the receptionist must disclose that it's an AI;
  - the status endpoint and permissions;
  - a streamed turn, with the model faked.
- **Live browser test** (in `scripts/e2e-designs-live.mjs`, 12/12): a new workspace's Pulse shows real data and the setup card. A full guided conversation then saves the phone, address, five days of hours, two services with prices, capacity 2, and a receptionist "Ava" with an AI-disclosing greeting. This is checked through the API.
- **Not tested here:** Claude mode against the real model, because there's no key in this environment.
