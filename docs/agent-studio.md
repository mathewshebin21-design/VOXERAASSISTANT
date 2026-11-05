# Agent Studio, conversation engine, Testing Lab and call intelligence

Agent Studio is where an owner designs how the receptionist handles calls, tests it, and publishes it. It lives at **VOXERA Flow → Agent Studio** (`/flow/app/studio`). The three design previews, the setup assistant, the staff desk and the simulator are unchanged.

## Feature matrix (Retell as a functional benchmark)
Retell's public documentation was used as a checklist of capabilities only. No Retell code, text or visual assets were used. Sources were read through web search, because `docs.retellai.com` is outside this session's allowed network:
- [Conversation flow node types](https://docs.retellai.com/build/conversation-flow/node);
- [webhooks](https://docs.retellai.com/features/webhook-overview);
- [batch test simulation](https://docs.retellai.com/test/batch-test-simulation);
- [interruption handling](https://www.retellai.com/learn/how-ai-voice-agents-handle-interruptions-and-natural-turn-taking).

Status values:
- ✅ implemented and tested;
- 🟡 partial;
- ❌ missing;
- 💷 needs a paid external integration (not connected).

| Capability | VOXERA | Notes |
|---|---|---|
| Visual conversation-flow builder | ✅ | React Flow canvas. Drag and drop, zoom and pan, outcome-specific connections with validation, undo/redo, autosave with conflict detection. |
| Node types | ✅ 14 / 🟡 | Greeting, ask, say, answer-from-knowledge, decide, open-now, find service, find free times, book, take details, action, pass to team, put through, end. Not yet: keypad digits (💷 telephony), SMS (💷), code nodes, MCP nodes, transfer to another agent. |
| Agent configuration | 🟡 | Greeting, persona, voice and language exist. Per-node interruption sensitivity and response speed don't exist yet. |
| Dynamic variables | 🟡 | Built-ins (intent, service, slot, caller number, local time…), answers saved by Ask and Take-details steps, and `{variable}` in messages. Variables passed in from a call's metadata need telephony (💷). |
| Function calling | 🟡 | Built-in, validated actions: availability, booking, find/cancel bookings, message, hand-over and transfer. Custom HTTP functions aren't built. |
| Knowledge base | 🟡 | Answers come only from the workspace's services, prices, hours, address, phone and description, with evidence recorded. Uploaded documents and URLs aren't supported (the Knowledge page is still demo). |
| Human transfer | ✅ logic / 💷 phone | Routes to the least-busy available employee, or managers only. Otherwise it queues or takes a callback. A real phone transfer needs telephony. |
| Live monitoring | 🟡 | The staff desk shows hand-overs live. Listening in on calls needs telephony (💷). |
| Post-call analysis | ✅ simulated / 💷 real | Outcomes, evidence-linked summaries, knowledge gaps and common questions. Custom extraction fields aren't built. |
| Simulation and batch testing | ✅ | Standard and custom scenarios with deterministic checks. Every publish runs the suite and is refused on any failure. Model-graded checks are skipped until an AI provider is approved. |
| Agent versioning | ✅ | Draft vs published, immutable numbered versions, rollback (republish as a new version), restore to draft, and a diff against published. |
| Webhooks | ❌ | No outbound call events yet. |
| Voice latency and interruptions | 🟡 | The Voice lab measures browser speech with barge-in. Phone-line latency needs telephony (💷). |
| Natural-language editing | ✅ (rules) / 💷 (AI) | Covers the common instruction types below. Free-form instructions need an approved AI provider. |

## Architecture
- **Flow document** (`services/api/app/flows/schema.py`): typed nodes with validated settings and declared outcomes, plus edges from an outcome to a node. The greeting must disclose the AI.
- **Validation** (`flows/validate.py`). A flow can't be published unless:
  - it has exactly one Start node;
  - every outcome is connected, with no dangling or duplicate edges;
  - every reachable step can finish the call;
  - there is no path to a booking that skips an availability check.
- **Storage** (migration 0008, row-level security per workspace):
  - `agent_flows`: one draft per agent, with an optimistic revision;
  - `agent_flow_versions`: immutable. The API role may insert, never update or delete;
  - `flow_sessions`: the exact graph each conversation ran, its state and its transcript;
  - `flow_tests`: saved test scenarios.
- **Engine** (`flows/engine.py`) is deterministic:
  - Rules interpret the caller: intent, yes/no, names, phones, dates, times and services.
  - Everything said comes from workspace data, and each answer records its evidence.
  - Availability, booking, hand-over and transfer call `app/reception.py`, the same code as the REST API. A flow can only offer times the diary has.
  - Global rules apply on every step: prompt-injection refusal, emergency escalation, and "speak to a person" goes to the transfer step. A side question asked mid-booking is answered, then the booking resumes. A changed service mid-booking is picked up.
  - Simulation and test runs execute every action for real inside a rolled-back savepoint, so validation is identical and nothing is saved. Live mode commits.
- **Language models**: the engine calls none. The existing Claude and OpenAI-compatible receptionist (`/live/brain`) is unchanged.
- **Testing Lab** (`flows/testing.py`): the twelve standard scenarios are seeded per agent, plus custom ones. Each result includes the transcript, tool calls with latency, evidence, outcome, tokens and estimated cost, and is labelled as a text simulation.
- **Natural-language editing** (`flows/instruct.py`): an instruction becomes a proposal with a full new graph, a before → after list, impact and validation. Nothing is saved until the owner confirms in the Studio. Unknown instructions are reported as not understood rather than guessed. Business settings are never touched.
- **Call intelligence** (`flows/insights.py`): computed from stored transcripts, per data kind (simulated / real), never mixed. Every figure is labelled.
- **API**: everything is under `/v1/orgs/{org}/agents/{agent}/flow`:
  - flow: `GET`, `PUT /draft`, `POST /validate`, `POST /publish`;
  - versions: `GET /versions/{n}`, `POST /versions/{n}/rollback`, `POST /versions/{n}/restore`, `GET /diff`;
  - sessions: `POST /sessions`, `POST /sessions/{id}/turn`, `GET /sessions[/{id}]`;
  - tests: `GET/POST /tests`, `PUT/DELETE /tests/{id}`, `POST /tests/run`;
  - editing and analytics: `POST /instructions`, `GET /insights`.
- **Permissions**: everyone in the workspace can view and run test calls and tests. Only owners and admins can edit, publish and roll back.
- **Web** (`apps/previews/src/app/flow/app/studio`, `components/flow/studio/*`, `lib/studio/graph.ts`):
  - canvas, inspector forms per node type, palette;
  - change-by-asking with a before/after view;
  - test call that highlights the node path, Tests, Versions and Insights panels;
  - publish dialog that shows failing tests;
  - stacked layout on phones.

## Natural-language instructions understood
- "When someone calls after 6 PM, offer to take a message."
- "If the customer wants a haircut, ask which barber they prefer."
- "If the caller asks for the manager, transfer to available management staff."
- "Don't accept appointments on Sundays." (Changes only what the receptionist offers. Opening hours are unchanged.)
- "If someone asks about parking, say there's free parking behind the shop."
- "Change the greeting to: …" (must still disclose the AI).

## Known limitations
- Caller understanding is rule-based. Unusual phrasing may route to "pass to the team" instead of being understood. An AI interpreter would need an approved provider and spending cap.
- Tests and test calls are text simulations. Voice quality, speech recognition and phone-line latency are not tested.
- Rescheduling inside flows routes to the team rather than moving the booking automatically.
- No custom HTTP functions, outbound webhooks, document knowledge base, SMS, keypad input or agent-to-agent transfer yet.
- There are no real calls until telephony is connected. "Real calls" analytics stay empty and say so.

## Deployment and migration impact
- **Migration 0008** adds four tables with row-level security and grants. It is additive only, and the production code before this change ignores them.
  - Run it explicitly per environment with `scripts/migrate.py` (see `deployment.md`). Builds never migrate.
  - The production build's read-only preflight refuses to deploy this code until the production schema is at 0008.
- **No new services, keys or paid calls.** The engine uses only Postgres.

## Estimated infrastructure cost of this work
- **New paid services: none.** Flows, tests, sessions and analytics run on the existing API and Postgres.
- **Neon**: storage grows with saved sessions and versions. Transcripts are a few kilobytes each.
  - The free plan shown on the Vercel store is 1 GB per project and 100 CU-hours per project.
  - Before relying on it, check the limits in the Neon console.
- **Vercel**: no change. Commercial use still needs a paid Vercel plan, as before. Check current pricing on Vercel's site.
- **Optional, not connected, need your approval**:
  - an AI provider for free-form intent and model-graded tests (pay per use, capped by the monthly token caps);
  - ElevenLabs voice;
  - telephony numbers and per-minute charges.
