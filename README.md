# VOXERA AI

Multi-tenant AI voice receptionist and appointment automation platform — **work in progress**.

> **Status: development and release validation; not ready for paying customers.** The canonical roadmap is Phases 0–10 in [the phase tracker](docs/VOXERA_Phase_Tracker.md). Historical PRs and design documents use provisional numbering. Browser/simulated tests do not establish live telephone readiness. UK and India launch, production release and paid-provider activation remain approval-gated.

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
| [`docs/phase-3-live-providers.md`](docs/phase-3-live-providers.md) | Connecting a real AI brain (Claude) and voice (ElevenLabs): keys, monthly caps, costs, verification |
| [`docs/setup-assistant.md`](docs/setup-assistant.md) | Built-in setup assistant (free guided mode + Claude agent) and real data on Flow's Pulse |
| [`docs/practice-receptionist.md`](docs/practice-receptionist.md) | Simulate answers from your workspace and answers the question asked; more natural browser voice |
| [`docs/design-a-b-live.md`](docs/design-a-b-live.md) | Real sign-in and real workspace dashboards in Command (A) and Atelier (B); demo as a separate option |
| [`docs/reception-desk.md`](docs/reception-desk.md) | Receptionist behaviour and tools, booking engine, multi-employee staff desk, dashboards by business type |
| [`docs/deployment.md`](docs/deployment.md) | Production vs staging isolation, explicit migrations, release and rollback procedures |
| [`docs/deploy-api-vercel.md`](docs/deploy-api-vercel.md) | Putting the API and database online (Vercel + Neon free tiers) |
| [`docs/voices.md`](docs/voices.md) | Free on-device Kokoro voices, custom-voice options and licences |
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

Follow the canonical [Phases 0–10 tracker](docs/VOXERA_Phase_Tracker.md): infrastructure/isolation; receptionist/onboarding; appointments/staff; Agent Studio; Testing Lab; browser voice; telephony; operations/QA; integrations; SaaS/billing; launch/security. Every phase requires recorded acceptance evidence. See [UK/India commercial readiness](docs/uk-india-commercial-readiness.md) for current release blockers.
