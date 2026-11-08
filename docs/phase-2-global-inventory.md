# Phase 2: VOXERA Global implementation inventory (2026-11-08)

Production: `claude/confident-shannon-7nb05f` at `0b04695` (PRs #25 and #26). Status values mean:
- **Production:** merged and deployed with verified health checks.
- **Branch:** on a development branch with CI evidence; not merged.
- **Absent:** does not exist yet.

## What exists

| Capability | Status | Evidence |
|---|---|---|
| SaaS foundation: auth, workspaces, roles, RLS, design selection, audit, export, deletion | Production | Phase 0/1 tracker, production acceptance 108/108 |
| Receptionist brain: prompt, 10 tools, confirm-before-booking, hand-off to staff, caps | Production | `app/live/receptionist.py`, `app/routers/live.py`, test suite |
| Prompt caching, shared provider connections, per-turn metrics | Production | PR #25 |
| Scripted-call harness (stand-in mode in CI) | Production | PR #26 |
| Browser Voice lab: browser STT, browser, Kokoro or ElevenLabs TTS, barge-in engine | Production | `apps/previews/src/lib/voice/*` |
| Shared Postgres login rate limiter (0010) | Branch, PR #27 | 19 tests; local rehearsal; migration not run |
| Call records and simulated calls (0011) | Branch, PR #28 | 25 tests; harness records every scenario; migration not run |
| Language registry, evidence levels, policy routing, language state | Branch `claude/phase2-global` | `tests/test_voice_routing.py` (25 tests) |
| Languages API and route preview; per-turn `language` in the brain | Branch `claude/phase2-global` | Same tests; the cached prefix is unchanged with a language set |
| Voice-worker prototype: session, brain client, LiveKit adapter | Branch `claude/phase2-global` | 13 session tests; adapter run against livekit-agents 1.8.11; stand-in call through the real API |
| Multilingual harness scenarios (hi, ml, ar, switching, Hinglish) | Branch `claude/phase2-global` | 12/12 scenarios in stand-in mode (plumbing only) |
| Receptionist wording by business country (currency, emergency numbers) | Branch `claude/phase2-global` | `tests/test_regions.py`; no number marked verified |
| Scoped worker credential and `/v1/worker/live/brain` | Branch `claude/phase2-global` | `tests/test_worker_auth.py` (6); stand-in call uses a minted token; off unless `VOXERA_WORKER_SECRET` is set |

## What does not exist yet

| Capability | Blocker |
|---|---|
| Telephony: numbers, SIP, transfer to a phone, voicemail | Provider choice and number purchase (owner approval) |
| Server-side STT and TTS for calls | Paid keys and caps (owner approval) |
| LiveKit server (Cloud or self-hosted); hosted worker | Hosting approval |
| Workspace voice policy stored per workspace | Migration (approval) |
| Number-to-workspace mapping | Migration (approval) |
| Any measured latency, audio quality, language accuracy or cost | Paid run (Sprint E) |
| Verified emergency numbers per launch country | Launch review per country (all entries unverified) |
| CRM, order-status and other integrations; billing | Later phases |

**Nothing above is claimed as supported for real callers.** Every voice result so far is simulated.
