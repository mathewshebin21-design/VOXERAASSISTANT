# ADR-0001: One Next.js app hosting three design previews over a shared headless layer

- **Status:** Accepted (Phase 1)
- **Date:** 2026-10-25

## Context
Phase 1 needs three genuinely distinct, runnable design previews so a design can be chosen before any backend work. Comparing them fairly needs identical data and behaviour; cost and maintenance need to stay low because two of the three will be discarded.

## Decision
- A single Next.js 15 (App Router) + TypeScript + Tailwind app at `apps/previews`, with route trees `/command`, `/atelier` and `/flow`.
- Each design has its **own** token set (CSS variables scoped by theme class, mapped to Tailwind colour namespaces `cmd-*`, `atl-*`, `flw-*`), own fonts, own component kit (`src/components/{command,atelier,flow}`), own navigation shell and own IA.
- A shared, UI-free layer in `src/lib`: seeded synthetic data, deterministic metrics, scheduling rules, knowledge utilities, rule-based simulator, and a client store (zustand + localStorage).
- Libraries: Recharts (charts), Framer Motion (animation), React Flow (`@xyflow/react`, node canvas), lucide-react (icons). Exact versions pinned.

## Consequences
- ✅ One `npm install`, one dev server, one CI job; designs are compared on identical data.
- ✅ The `src/lib` contracts (tool names/arguments, booking rules, metric definitions) carry forward to Phases 2–7 and are unit-tested.
- ⚠️ Bundle includes all three designs — irrelevant for a preview; the losing designs will be deleted after selection.
- ⚠️ State lives in the browser only. Phase 2 replaces the store with a tenant-scoped API.
- ⚠️ Demo time is a fixed naive wall-clock (`DEMO_TODAY`); the production scheduler must be fully time-zone aware (note: UK clocks change on 25 Oct 2026, inside the demo's date range).

## Alternatives considered
- **Three separate apps:** more isolation, triple the tooling and drift risk.
- **Storybook-only previews:** not "runnable applications" with navigation and flows.
