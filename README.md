# VOXERA AI

Multi-tenant AI voice receptionist and appointment automation platform — **work in progress**.

> **Current stage: Phase 1 design approval gate.** The repository contains competitive research and three interactive design previews running on synthetic data. There is **no production backend, no telephony and no live AI model** yet. Nothing here should be described as production-ready.

## Contents

| Path | What it is |
|---|---|
| [`docs/research/phase-0-competitive-research.md`](docs/research/phase-0-competitive-research.md) | Competitive and technical research, UK regulatory notes, recommended initial market, MVP definition |
| [`docs/design/phase-1-design-previews.md`](docs/design/phase-1-design-previews.md) | The three design directions, strengths and weaknesses, what's real vs simulated, verification results |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`apps/previews`](apps/previews) | Runnable Next.js app with Design A (Command), B (Atelier) and C (Flow) |

## Run the previews

Requirements: Node.js 22, npm 10.

```bash
cd apps/previews
npm install
npm run dev          # http://localhost:3000
```

Or a production build:

```bash
npm run build && npm start   # http://localhost:3000
```

Open `http://localhost:3000` and choose a design:

- **A — Command:** `http://localhost:3000/command`
- **B — Atelier:** `http://localhost:3000/atelier`
- **C — Flow:** `http://localhost:3000/flow`

Settings you change (agent persona, knowledge edits, published versions, simulator bookings) are kept in your browser's localStorage only.

## Checks

```bash
npm run lint && npm run typecheck && npm test   # unit tests (Vitest)
BASE_URL=http://localhost:3000 npm run e2e      # browser E2E (needs Playwright + Chromium available)
```

## Roadmap

Phases 2–14 (multi-tenant foundation, real-time voice engine, telephony, receptionist intelligence, knowledge engine, scheduling, integrations, agent studio, analytics, privacy and security, testing, deployment, commercial readiness) begin only after a design is approved.
