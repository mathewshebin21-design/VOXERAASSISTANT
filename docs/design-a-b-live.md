# Command (A) and Atelier (B): real sign-in and real workspace data

## Sign in / Create workspace
- `/command/login` and `/atelier/sign-in` now have real **Sign in** and **Create workspace** tabs. They use the same API session as Flow:
  - httpOnly cookies through the Next.js proxy;
  - the same password rules;
  - real error messages.
- Each form is drawn in its design's own look: Command's dark console, Atelier's paper and serif.
- The logic is shared in `src/lib/live/auth-form.ts`, which Flow's `/flow/enter` now uses as well.
- If you're already signed in, the page says so, with **Open console** / **Enter your studio** and **Sign out**.

## Demo vs your workspace
- **Explore with demo data** is a separate, clearly labelled button. It appears on both sign-in pages and both landing pages, and in the account menu when you're signed in. It opens the synthetic salon and saves nothing.
- `src/lib/live/data-mode.ts` decides what a screen shows:
  - **live:** signed in, with a workspace, and not exploring the demo;
  - **demo:** anything else.
- A signed-in user can switch to the demo and back without signing out; a banner says they're exploring the demo. Signing in always returns to the real workspace.
- Shells show the real workspace name, the user's initials, a **Live** or **Demo** badge, and an account menu (switch to demo or back, sign out).

## Dashboards with real data
- **Command → Operations** and **Atelier → Today** read the signed-in workspace from the API.
  - `src/lib/live/dashboard.ts` fetches everything in parallel; a pure, unit-tested `summarise()` works out the figures.
  - Times are shown in the workspace's own time zone.
- **What they show:**
  - upcoming bookings: today, the next 7 days, and how many were booked by the AI;
  - the desk queue: waiting, urgent, in progress, resolved in the last 7 days;
  - team availability;
  - usage this month (owners and admins);
  - recent voice-lab test calls.
- **A new workspace** gets a welcome and a 6-step setup checklist: details, hours, services, receptionist, team, desk. Every panel has a plain-language empty state ("No bookings yet…", "Nobody waiting…").
- **Calls are never invented.** The call panels say "No calls yet" until a phone line is connected (Phase 4).
- **Other screens** in A and B still use demo data. When you're signed in, they say so clearly and link back to the live dashboard. Workspace settings links open the full editor (Flow's workspace pages), and say so.

## Verification (2026-11-01)
- Unit: 56, including 3 for `summarise()`. These cover a new workspace, time-zone-correct today and next-7-days counts, AI bookings, and desk counts.
- Demo browser suite: 129/129. It includes both sign-in pages: the real form, a wrong password shows an error and stays on the page, and the demo is a separate choice.
- `scripts/e2e-designs-live.mjs`: 10/10 against the API and Postgres, also run in CI. It:
  - creates a workspace in Command's form;
  - checks the empty states;
  - creates a booking and a desk case and sees them on both dashboards;
  - checks the demo-screen notices;
  - switches to the demo and back;
  - signs out, gets a wrong password rejected, and signs in with Atelier's form;
  - checks that signed-out users see the labelled demo.
- Flow live suite unchanged: 26/26.
