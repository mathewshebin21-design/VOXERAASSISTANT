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

"Barber", "gents hairdresser" or "men's grooming" in the business-type answer selects Barbershop. Both modes offer the template: step-by-step when you say "template", and the Claude agent through its `get_business_template` tool. The API keeps its own copy at `services/api/app/live/templates/barbershop.json`, and a test fails if the two copies drift apart.

## Understanding owners without confusion

The setup assistant is the first thing every new business talks to, so it is built for the way owners actually type. Nothing is saved until the owner has seen it, and anything it assumed is listed alongside.

| Owners write | It understands |
|---|---|
| "Monday to Friday, 9am-5pm", "9.30-5.30 mon-sat" | Days and times in any order, split by commas or not |
| "every day except Sunday 9-6", "9-6 except sundays" | Sunday closed |
| "mon-fri 9-12 and 1-5", "Mon-Fri 9-5 closed 1-2 for lunch" | Two opening periods that day (the API stores both) |
| "Thursday late night till 9", "open 24/7", "Monday off" | Only Thursday's closing time changes; 00:00–23:59; Monday closed |
| "closed bank holidays" | Noted, with a prompt to put it in the business description |
| "Haircut £18-£25 30 mins", "20-25 pounds" | Saves £18 / £20 as the starting price, and says so |
| "Mens cut 30 mins 20", "Skin fade 45 £24", "twenty five pounds" | £20; 45 minutes; £25, each stated as an assumption |
| "PT 1 hr £40, Group class 45 min £10" | Two services |
| "HAIRCUTS:" above a list, "Skin fade ...... £24" | A category; a pasted price list |
| "Free consultation", "Bridal makeup POA" | £0; no fixed price |
| "(0117) 496 0123", "0044 117…", "+44 (0)117…" | A UK number |
| "45 Market St Manchester M1 1AA" | Street, town and postcode without commas |
| "4 chairs but 2 barbers", "me and two others" | 2; 3 |
| 👍, "go ahead", "sounds good" | Yes |

**Corrections change only what they name.** With hours or services shown and waiting for a yes:

- "yes but Thursday till 9 and Sunday closed" or "Saturday 9-5" changes only those days.
- "remove head shave and perm or texturising" removes two services, even though names contain "and" and "or".
- "skin fade £25", "change kids cut to 20 min" and "hot towel shave is £25" update one service. Matching ignores bracketed notes, and every word typed must be in the name.
- "fade £25" matches several fades, so it asks which one. A pending list is never thrown away because of a misunderstanding: unrecognised new lines are added to it, and only "start the list again" clears it.
- "add beard dye 20 min £15" adds a service. "template but remove head shave" loads the template and changes it in one go.
- Services typed without a length get the template's typical length when the business has a template (for example kids' cut 25 minutes for a barbershop), otherwise 30 minutes, marked "(assumed)".

**Questions and moving around.** "What does capacity mean?" or "why do you need this?" gets a plain explanation, then the question again. "Go back", "start again", "change the hours" and "edit services" go to that step. "How about Mary-Jane" is an answer, not a question.

The Claude agent gets the same rules in its instructions, plus `update_service` and `remove_services` tools so corrections never re-add or wipe the rest. A part-name works only when it matches a single service; otherwise it lists the matches and asks.

Tests: `apps/previews/src/lib/setup/parse.test.ts` and `guided.test.ts` hold each of these phrasings and conversations; `services/api/tests/test_setup_assistant.py` covers the agent's tools.

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
