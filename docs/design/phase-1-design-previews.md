# VOXERA AI — Phase 1: Design Previews

_Status: awaiting design selection (A, B or C). No production backend has been built._

All three previews live in one Next.js app (`apps/previews`) under separate route trees, each with its own design tokens, typography, navigation model, layout system and component kit. They share **only** the headless logic layer (`src/lib`): the synthetic dataset, metrics, scheduling rules, knowledge utilities and conversation simulator. That keeps the comparison fair — differences you see are design differences, not behaviour differences — and the shared layer is reusable whichever design is chosen (see [ADR-0001](../decisions/ADR-0001-preview-architecture.md)).

## What is real and what is simulated

| Real (working code, tested) | Simulated / placeholder |
|---|---|
| Navigation, forms, validation, editable settings (persisted in your browser's localStorage) | **All calls, callers, transcripts and appointments** — generated from a fixed seed (fictional "Halden & Rye" salon) |
| Deterministic analytics computed from call records, with click-through to the calls behind each number | **Latency** numbers on calls — generated, labelled "simulated, not measured" |
| Availability engine: hours, staff skills, durations, buffers, conflicts, patch-test lead time, idempotent booking, explicit confirmation | **Costs** — estimated from public list prices (`src/lib/pricing.ts`), not metered |
| Rule-based conversation simulator: tool calls, guardrails, barge-in, provider-failure mode | The simulator is a **rule-based stand-in for the LLM**; phrasing is simpler than a real model |
| Knowledge retrieval tester, conflict detection, prompt-injection screening for pasted documents | **Integrations** — status badges only; no OAuth, no real calendar or CRM writes |
| Agent version publish / rollback | **Telephony** — none. "Live monitor" replays recorded demo transcripts on a timer |
| Optional browser speech: speech synthesis for replies, browser speech recognition for the mic (Chrome/Edge) | Browser voices stand in for production TTS voices |
| — | **Authentication** — sign-in screens are visual only |

Every screen carries a visible "demo / simulated" label (an E2E check enforces this).

---

## A — VOXERA Command
**Enterprise voice operations terminal.** Route: `/command`

- **Design system:** charcoal/black surfaces, electric violet primary, restrained cyan for tools/data, Inter + JetBrains Mono, 1px hairline panels, grid backdrop, monospaced kicker labels.
- **Navigation:** fixed left sidebar grouped Operate / Build / Admin, `Ctrl K` command palette, `Alt+0–9` shortcuts; slide-out drawer on mobile.
- **IA:** Operations · Live monitor · Calls & transcripts · Appointments · Agent config (+ wizard) · Knowledge · Simulator · Integrations · Team & audit · Usage & billing.
- **Signature interactions:** canvas waveform; three-lane live monitor with tool traces; heatmap; staff-lane day calendar with "now" line; transcript scrubber with PII redaction, JSON export and delete; tool-call cards expanding to arguments; state inspector + tool/guardrail trace in the simulator.

**Strengths**
- Highest information density; makes the AI's work fully inspectable (tools, guardrails, latency, versions).
- Best fit for agencies, multi-site operators and our own support team; strongest "AI engineering" portfolio signal.
- Scales naturally to multi-tenant admin, audit logs and team roles.

**Weaknesses**
- Intimidating for a single salon owner; jargon (p50, tool names) needs translating.
- Dense tables need care on mobile (they scroll horizontally inside panels).
- Visually closest to existing developer dashboards (Vapi/Retell), so less distinctive.

## B — VOXERA Atelier
**Luxury AI receptionist studio.** Route: `/atelier`

- **Design system:** warm ivory paper, graphite ink, champagne accents, Cormorant Garamond display + Inter body, generous whitespace, rounded 22px cards, editorial rules.
- **Navigation:** three "rooms" in the top bar — **Front desk**, **Studio**, **House** — each revealing its sections underneath; `Ctrl K` quick-find and `Alt+number` shortcuts; on mobile a floating bottom tab bar plus a scrollable strip of every section.
- **IA (plain language):** Front desk — Today · Live · Journal (calls) · Diary (calendar) · Insights. Studio — Voice & manner · Conversation map · Notebook (knowledge) · Rehearse (simulator). House — Connections · Team & activity · Plan & usage. The wizard is told in "chapters".
- **Feature parity:** after review feedback, Atelier now includes **every capability from Command (A) and Flow (C)**, translated into owner language — see the parity table below.
- **Signature interactions:** narrative dashboard; "Needs your eye" queue; "hear the difference" preview that re-runs the simulator as you move warmth/detail sliders; escalation rules written as sentences; phone-shaped rehearsal room whose conversation path lights up on an ivory conversation map; journal reading pane with replay; month / week / day-by-stylist diary.

**Strengths**
- Most approachable for the recommended market (independent UK salons); turns technical controls into owner language.
- Strong premium brand feel that justifies a premium price.
- Lower cognitive load; good on mobile, where owners actually work.

**Weaknesses**
- Now that it carries every A and C feature, it has the most sections (13), so the grouped navigation matters; some operator detail (tool arguments, timings) is one click deeper than in Command.
- Editorial spacing means more scrolling on data-heavy screens (Insights, Diary).
- Serif-heavy style is opinionated; may not suit every vertical (e.g. trades, agencies).

## C — VOXERA Flow
**AI-native conversation studio.** Route: `/flow`

- **Design system:** near-black with violet/cyan aurora, glass panels, glowing state, Space Grotesk display, animated orb.
- **Navigation:** floating icon rail (desktop) and floating scrollable dock (mobile); canvas pages use full width.
- **IA:** Pulse · Canvas · Simulate · Knowledge · Calls · Calendar · Tools · Usage; wizard "generates" the flow graph live as you answer.
- **Signature interactions:** node-based conversation canvas (React Flow) with an inspector — persona & voice live on the Persona node, tool nodes show their argument contracts; simulator highlights the active node and lights the path taken in real time; tool execution panel with arguments and timings; intent→outcome routing chart; glowing AI-booked blocks in the calendar.

**Strengths**
- Most distinctive and memorable; makes the agent's logic **visible**, which is a real differentiator story ("design how your receptionist thinks").
- Best demo/portfolio piece and best for explaining guardrails to buyers.
- Natural foundation for future visual flow editing (Phase 9).

**Weaknesses**
- Graph metaphor is more than most salon owners need; risk of looking like a developer tool.
- In this preview the graph mirrors fixed simulator logic — **editing the graph structure is not implemented**, and real free-form graph editing is a substantial build (validation, versioning, testing every path).
- Glow/glass effects need restraint for accessibility (contrast) and lower-end devices.

---

## Atelier feature parity with Command and Flow

| Capability | From | Where it lives in Atelier |
|---|---|---|
| Live call monitor (3 lines, speaking indicator, last action, disabled listen-in/take-over/end) | A | Front desk → Live |
| Analytics: 7/14/28-day range, period-on-period change, volume, outcomes with evidence links, latency vs 1 s target, intents, weekday×hour heatmap, latest calls | A | Front desk → Insights |
| Gauges (answered, enquiries→booked, handed over) and intent→outcome routing chart | C | Front desk → Insights |
| Call search, outcome / reason / answered filters, evidence view via URL, CSV export, totals | A | Front desk → Journal |
| Transcript replay scrubber, expandable action arguments, call facts (latency, cost, edition, mood), compliance checks, PII hide, JSON export, delete | A, C | Journal → conversation |
| Day-by-stylist lanes with working hours and "now" line, week view, AI-booked-only filter, booking stats (28-day, no-shows, today, next 7 days), by-channel chart, booking rules, link to source call | A, C | Front desk → Diary |
| Language, speaking rate, voice preview, transfer permission, after-hours behaviour, transfer destination, bookable services, recording notice text, retention days, editions publish/rollback | A | Studio → Voice & manner |
| Node-based conversation map with inspector (persona & voice, permissions, locked safety steps, action contracts) and publishing | C | Studio → Conversation map |
| Document import with prompt-injection set-aside, source list | A, C | Studio → Notebook |
| Live path highlighting, state panel, action & house-rule trace with arguments and timings, turn timing table | A, C | Studio → Rehearse |
| Wizard with live "conversation map so far" preview | C | Set up a new receptionist |
| Integration detail (auth, access, key storage), webhook delivery log, registry of every action with on/off controls | A, C | House → Connections |
| Team members, role changes, invites, permission matrix, activity (audit) log | A | House → Team & activity |
| Cumulative minutes vs allowance, per-minute cost breakdown, plan margins | A, C | House → Plan & usage |
| Quick-find (`Ctrl K`), keyboard shortcuts, SSO option on sign-in (planned) | A | Everywhere |

Command and Flow have **not** been given Atelier-only features (narrative summary, "Needs your eye", sentence-style rules, "hear the difference"); that can be done if you want all three to be exact equals.

---

## Verification performed

Run on the production build (`next build` + `next start`):

| Check | Result |
|---|---|
| Unit tests (Vitest) — metrics, scheduling, simulator behaviour, retrieval/injection/conflicts | **33 / 33 passed** |
| TypeScript `tsc --noEmit` | clean |
| ESLint (`next/core-web-vitals`, `next/typescript`) | clean |
| Browser E2E (Playwright): every route on desktop 1440×900 and mobile 390×844 — HTTP status, zero console/page errors, no horizontal overflow on mobile, visible demo label | **88 / 88 passed** (44 routes × 2 viewports) |
| Simulator: booking created **only after** explicit confirmation (each design) | 3 / 3 passed |
| Simulator: prompt-injection attempt blocked (each design) | 3 / 3 passed |
| Simulator: barge-in interrupts the agent and the new question is answered (each design) | 3 / 3 passed |
| Wizard: greeting without AI disclosure blocks progress (each design) | 3 / 3 passed |
| **Total browser checks** | **100 / 100 passed** |

Not verified: real voice quality, real latency, telephony, screen-reader walkthroughs (only basic ARIA roles/labels and focus styles are in place), and performance on low-end devices.

Bug found and fixed during verification: the simulator never cleared its speech timer after the agent finished, so every caller turn was mislabelled as a barge-in. Scenarios now wait for the agent to finish speaking, and a dedicated barge-in test was added.

## Screens per mandatory feature

| Feature | A — Command | B — Atelier | C — Flow |
|---|---|---|---|
| Landing page | `/command` | `/atelier` | `/flow` |
| Authenticated dashboard | `/command/ops` | `/atelier/studio` | `/flow/app` |
| Agent creation wizard | `/command/agents/new` | `/atelier/studio/create` | `/flow/app/new` |
| Personality & voice | `/command/agents` | `/atelier/studio/voice` | `/flow/app/canvas` (Persona node) |
| Knowledge editor | `/command/knowledge` | `/atelier/studio/knowledge` | `/flow/app/knowledge` |
| Conversation simulator | `/command/simulator` | `/atelier/studio/rehearse` | `/flow/app/simulate` |
| Call history | `/command/calls` | `/atelier/studio/calls` | `/flow/app/calls` |
| Transcript viewer | `/command/calls/[id]` | `/atelier/studio/calls/[id]` | `/flow/app/calls/[id]` |
| Appointment calendar | `/command/appointments` | `/atelier/studio/diary` | `/flow/app/calendar` |
| Integrations | `/command/integrations` | `/atelier/studio/connections` | `/flow/app/integrations` |
| Usage & billing | `/command/billing` | `/atelier/studio/plan` | `/flow/app/usage` |
| Extra | Live monitor, Team & audit | Live, Insights, Conversation map, Team & activity (full A + C parity) | Node canvas |
| Mobile | drawer nav | bottom tab bar + section strip | floating dock |
