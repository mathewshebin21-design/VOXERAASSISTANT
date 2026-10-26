# Phase 3 — Real-time voice engine

**Status:** implemented and tested with browser and local engines. **No paid provider is connected.** The latency figures below are produced by the engine at run time; none are quoted here because none have been measured on production providers yet.

## What was built
| Area | Where | Notes |
|---|---|---|
| Provider contracts | `apps/previews/src/lib/voice/types.ts` | `SttAdapter`, `BrainAdapter`, `TtsAdapter`, `TurnMetrics`, session events |
| Session engine | `…/voice/engine.ts` | Turn-taking, streaming by sentence, barge-in with an echo guard, silence prompts and hang-up, final-transcript timeout, brain timeout, brain/TTS/STT failover |
| Voice activity detection | `…/voice/vad.ts` | Room calibration, adaptive noise floor, minimum speech length, hangover and hysteresis |
| Brains | `…/voice/brains.ts` | Rule-based receptionist (same tools and guardrails as the simulator); message-taker fallback |
| Browser adapters | `…/voice/browser.ts` | Web Speech recognition (interim results, auto-restart), `speechSynthesis` with a start watchdog, text-paced fallback voice, microphone VAD with echo cancellation and noise suppression |
| Failure drills | `…/voice/faults.ts` | Inject brain errors or hangs and TTS failures |
| Metrics | `…/voice/summary.ts` | p50/p95 per stage, time to first audio, barge-in recovery, failure rate per stage, cost per minute (`null` when a price isn't configured) |
| Voice lab UI | `/flow/app/voice` | Live transcript with partial results, interrupted replies marked, measured latency per turn, provider status, failure drills, VAD meter and tuning, JSON export, save to workspace |
| API | `services/api/app/routers/voice.py`, migration `0003` | `POST/GET /v1/orgs/{id}/voice-sessions`. Idempotent; the server recomputes the summary; RLS; no UPDATE grant; audited; included in workspace export; deleted with the workspace. Stores metrics only, no audio or transcripts. |
| Decision record | `docs/decisions/ADR-0004-voice-engine.md` | Framework and provider evaluation, with sources |

## Phase 3 requirements → implementation
| Requirement | How |
|---|---|
| Natural turn-taking | Phase machine; commit on final transcript; silence prompts |
| Low-latency streaming | First sentence is spoken while the brain is still producing the rest |
| Interruption handling / barge-in | VAD, partial transcript (≥ 2 words) or typing aborts the brain and TTS; recovery time measured |
| Silence detection | VAD hangover for end of speech; 12 s no-input prompt, then goodbye |
| Background noise resilience | Calibrated, adaptive noise floor; browser noise suppression; click rejection |
| Partial transcription | Interim results shown live; last partial committed if no final result arrives |
| Streaming responses | Brain is an async stream, cut into sentences for TTS |
| Tool execution during calls | Tool chunks are emitted mid-turn while speech continues |
| Recovery from provider failures | Recovery line → fallback brain; TTS → text; STT → typed; each fallback recorded |
| Measure TTFA, STT, LLM, TTS, E2E, interruption recovery, failure rates, cost/min | `TurnMetrics` + `summarise`, shown live and saved per workspace |

## Verification (run in this environment, 2026-10-25)
- Unit tests: 46 pass (13 new for the engine, VAD and summary, using fake adapters and fake timers).
- Browser E2E (`scripts/e2e.mjs`): 121/121, including `/flow/app/voice` on desktop and mobile, plus 5 voice-lab checks:
  - greeting with time to first audio measured;
  - tool call during a streamed reply;
  - barge-in;
  - recovery from a brain failure;
  - hang-up.
  
  Headless Chromium has no working speech engines, so these runs also exercise the synthesis watchdog and the text-only fallback.
- Live E2E against FastAPI + PostgreSQL (`scripts/e2e-live.mjs`): 22/22, including saving a test call and seeing it in the audit log.
- API tests: 62 pass (5 new: idempotency, server-side summary, validation that rejects transcript fields, roles, tenant isolation, RLS without context, export). Migration 0003 downgrades and upgrades cleanly.

**Not verified here:**
- A real microphone with real speech. The container has no audio device, so the Web Speech and microphone paths were exercised only up to feature detection and the fallback paths.
- Any hosted provider.

Try the voice lab in Chrome on a laptop or phone, with headphones.

## Barge-in rules (revised after real-world testing, 2026-10-26)
A first test on a MacBook showed every reply being cut off before it was heard. Room noise, and the agent's own voice coming from the speakers, counted as the caller interrupting, even while the agent was still preparing its reply. The rules are now:
- While the agent is **preparing** a reply, only recognised words interrupt it. Noise never does.
- While it is **speaking** and a speech recogniser is running, only recognised words of at least two words interrupt it, and only if they are not an **echo** of what the agent just said (70% word overlap means echo).
- With **no** recogniser (typed input), sustained voice activity of 350 ms or more interrupts.
- The on-device Kokoro voice loads **before** the call starts. If a sentence takes more than 10 s to generate, the call switches to the browser voice.
- The recogniser's English variant is selectable (UK, India, US, Ireland, Australia, South Africa).

These rules are covered by unit tests, plus a browser test with a noisy fake microphone.

## Live providers
The real AI brain (Claude) and voice (ElevenLabs) are now wired in behind server-side keys and monthly caps. See [`phase-3-live-providers.md`](phase-3-live-providers.md).

## What needs your approval next
Connecting real providers costs money and needs accounts that only you can create. Proposed order:
1. One STT, one TTS and one LLM provider (shortlist in ADR-0004), with a **monthly spending cap you set**. Keys go in server-side environment variables only.
2. Measure them in the voice lab and a server-side harness on the same scripted calls, then pick.
3. Phase 4 telephony on LiveKit Agents (or Pipecat) with a test phone number. **No number is bought and no call is placed without your go-ahead.**
