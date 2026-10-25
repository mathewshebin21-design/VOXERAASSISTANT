# @voxera/previews

Phase 1 design previews for VOXERA AI. See [`docs/design/phase-1-design-previews.md`](../../docs/design/phase-1-design-previews.md).

```
src/
  app/
    page.tsx            design chooser
    command/            Design A — enterprise operations terminal
    atelier/            Design B — luxury receptionist studio
    flow/               Design C — node-based conversation studio
  components/
    command|atelier|flow/   per-design component kits and shells
    shared/hours.tsx        themed opening-hours editor used by all wizards
  lib/                  shared, UI-free logic (unit tested)
    demo-data.ts        seeded synthetic business, calls, appointments, transcripts
    metrics.ts          deterministic analytics + evidence filters
    scheduling.ts       availability, conflicts, idempotent booking, confirmation rule
    simulator.ts        rule-based receptionist (tools, guardrails, failure modes)
    knowledge.ts        retrieval scoring, prompt-injection screen, conflict detection
    use-simulator.ts    streaming / barge-in / browser speech hook
    store.ts            client state (agent config, versions, knowledge) in localStorage
    pricing.ts          cost assumptions + draft plans
scripts/
  e2e.mjs               Playwright smoke + behaviour checks (desktop + mobile)
  showcase.mjs          captures in-use screenshots
```

Everything is synthetic: "Halden & Rye" is a fictional salon, and no call, number or integration is real.
