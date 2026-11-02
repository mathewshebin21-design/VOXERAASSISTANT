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

## Just tell it what you want

Owners don't have to find the right step or a settings page. At any point, during setup or long after it, they can type what they want changed. The assistant changes the saved workspace straight away, says exactly what changed (before → after), and **"undo"** puts it back.

| Owner says | What happens |
|---|---|
| "skin fade is now £25", "change the price of the hot towel shave to £24", "make kids cut 20 minutes" | That one service is updated |
| "put all prices up by £2", "increase all haircuts by 10%" | Every priced service (or one category) changes, with each new price listed |
| "we don't do perms anymore", "remove head shave and beard colour" | Those services are removed |
| "add beard dye 20 min £15", "we now offer eyebrow threading £7" | A service is added (a missing length uses the template's typical time, or 30 minutes, and says so) |
| "rename line-up / edge-up to Shape up" | Renamed |
| "we're closed on Mondays now", "change Saturday to 9-5", "Friday 9-12 and 1-7" | Only those days change |
| "we close at 6 on Wednesdays", "we open at 10 on Saturdays", "open till 9 on Thursdays" | Only that end of those days moves |
| "our new number is 07700 900123", "we've moved to 12 High Street, Leeds, LS1 4DJ" | Phone or address updated |
| "we have 3 barbers now", "we hired another barber", "one of the barbers left" | Capacity 3; +1; −1 |
| "rename the receptionist to Sam", "change the greeting to …" | Name updated (and in the greeting); a greeting without an AI disclosure gets one added, and the owner is told why |
| "tell callers we have free parking", "we're closed on bank holidays" | A sentence is added to the description the receptionist answers from; what's already there is kept |

It asks instead of guessing when a request could mean two things: "fade £26" when there are four fades, "we close at 5" with no days, "open till 9 on Mondays" when Monday is closed, or a service name it can't find (it lists what there is).

How it fits around the step-by-step questions:

- A change about something else is made, then the current question is asked again. A list or week waiting for a yes stays waiting.
- The answer to the question being asked wins: "we're a barbers with 3 chairs" at the business-type question sets the business type.
- Back at the hours step with hours already saved, "Saturday 9-5" changes Saturday only and keeps the rest of the week. This was the limitation in the previous version.
- After setup, "what can I change?" lists examples, and anything it doesn't catch gets a hint on how to ask.

The logic is in `apps/previews/src/lib/setup/commands.ts`, which reads a request against the saved workspace and returns the changes plus their exact reverse for undo. The setup screen applies them through the normal API (services are found by their current name), and `commands.test.ts` covers each phrasing above.

The Claude mode works the same way: its instructions say to make requested changes straight away with before → after, undo on request, append to the description rather than replace it, and ask only when a request is ambiguous. A new `update_receptionist` tool renames the receptionist or changes its greeting (still checked for the AI disclosure) instead of creating a second one.

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

## Data integrity of changes and undo
- Removing a service (AI or guided mode) hides it from callers (`active = false`) instead of deleting it. Existing bookings keep their link to the service.
- "Undo" (adding the same name back) restores the very same service, with the same id. Before this, a removal followed by undo created a new service, and the old bookings lost their link. In guided mode, undo could also silently fail on the unique name.
- The AI assistant needs the exact service name to remove one. A partial name is refused, with a "did you mean".
- Every AI change returns its `before` and `after` values (opening hours return `previous_hours`), so "undo" puts back exactly what was there.
- Only owners and admins can run the AI assistant (tested: managers, staff and viewers get 403 before any provider call; other workspaces get 404). Every tool is limited to the signed-in workspace by row-level security and explicit workspace filters.
