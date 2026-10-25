# VOXERA AI

Multi-tenant AI voice receptionist and appointment automation platform — **work in progress**.

> **Current stage: Phase 3 (real-time voice engine) implemented with browser engines; Phase 2 (multi-tenant foundation) complete.** Design **C — Flow** was approved. The repository contains the research, the design previews (running on synthetic data) and a tested multi-tenant API. The Flow front end is connected to the API for accounts, workspaces, team, business data, agents and usage. The Voice lab (`/flow/app/voice`) runs the real-time voice engine with your browser's speech engines and a rule-based brain. There is **no telephony and no paid AI or speech provider** connected yet. Nothing here should be described as production-ready.

## Contents

| Path | What it is |
|---|---|
| [`docs/research/phase-0-competitive-research.md`](docs/research/phase-0-competitive-research.md) | Competitive and technical research, UK regulatory notes, recommended initial market, MVP definition |
| [`docs/design/phase-1-design-previews.md`](docs/design/phase-1-design-previews.md) | The three design directions, strengths and weaknesses, what's real vs simulated, verification results |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`apps/previews`](apps/previews) | Runnable Next.js app with Design A (Command), B (Atelier) and **C (Flow — approved)** |
| [`services/api`](services/api) | FastAPI + PostgreSQL multi-tenant API (auth, workspaces, roles, RLS isolation, business data, audit, usage, export/deletion) |
| [`docs/phase-2-foundation.md`](docs/phase-2-foundation.md) | Phase 2 scope, verification and limitations |
| [`docs/phase-3-voice-engine.md`](docs/phase-3-voice-engine.md) | Phase 3 voice engine: what's built, how it's measured, verification, what needs approval |
| [`docs/decisions/ADR-0004-voice-engine.md`](docs/decisions/ADR-0004-voice-engine.md) | Voice framework and provider evaluation (LiveKit Agents, Pipecat, realtime models, open source) |

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

## Run the API

See [`services/api/README.md`](services/api/README.md), or run everything with `docker compose up`.

To use real workspaces in the Flow UI, start the API on port 8000 and the web app with `VOXERA_API_URL=http://127.0.0.1:8000`, then open http://localhost:3000/flow/enter. Without the API, Flow runs in demo mode.

## Roadmap

Phases 4–14 (telephony, receptionist intelligence, knowledge engine, scheduling, integrations, agent studio, analytics, privacy and security, testing, deployment, commercial readiness) follow, one at a time.
