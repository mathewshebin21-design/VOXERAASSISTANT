# ADR-0005: Voice worker for phone calls

- **Status:** Proposed, for owner review. Nothing is built, bought or connected by this ADR.
- **Date:** 2026-11-08
- **Builds on:** ADR-0004, which chose LiveKit Agents for telephony with Pipecat as the
  alternative, and audit finding V1 in `docs/phase-2-voice-backend-audit.md`.

## Context

Today a "call" is the browser Voice lab:
- speech recognition runs in the browser;
- each caller turn is one SSE request to `/live/brain` on a Vercel Python function;
- each spoken sentence is one request to `/live/tts`.

A phone call cannot work like that:
- it needs one long-lived, two-way audio connection for the whole call (minutes, not seconds);
- speech recognition must run on the server, because the audio arrives there from the phone network;
- barge-in must cut speech within a fraction of a second.

Vercel functions are request-scoped and time-limited, so they cannot host this.

**Constraint:** the receptionist's behaviour is already built and tested, and must not be duplicated or forked:
- the prompt;
- the tools and their validation;
- the confirm-before-booking rule;
- tenant isolation;
- the monthly caps.

## Decision (proposed)

### 1. A separate, long-running voice worker
- A Python service built on **LiveKit Agents** (ADR-0004).
- It owns the media path: phone audio in, voice-activity detection and end-of-turn detection, streaming speech-to-text, streaming text-to-speech, and barge-in.
- It runs one session per active call.

```
Phone network ─SIP─▶ telephony provider ─SIP─▶ LiveKit (SIP + rooms) ◀──▶ voice worker
                                                                            │  audio ⇄ STT/TTS
                                                                            │  caller text, per turn
                                                                            ▼
                                                           VOXERA API: worker brain endpoint (stream)
                                                           same receptionist, tools, caps, tenancy
                                                                            │
                                                                            ▼
                                                                Postgres (RLS) — call records
```

### 2. The worker does not contain the receptionist; it calls the API
- Each caller turn goes, as text, to a **worker brain endpoint** on the existing API. That endpoint uses the same code path as `/live/brain`: `receptionist.py`, `run_tool`, `toolcheck`, `budget.reserve`/`settle`, and the Step 1 caching and metrics.
- It streams text back, and the worker speaks it sentence by sentence.
- One code path means one set of tests, one place where caps and tenancy are enforced, and the existing acceptance suites keep covering it.
- **Cost of this choice:** one extra network hop per turn, between worker and API. Keep both in the same region (UK/EU) and measure the hop with the harness. If it proves material, the fallback is a shared Python package used directly by the worker, still with the runtime role and RLS.

### 3. Worker identity and authorisation
- The worker authenticates to the API with its own **service credential**, not a user token.
- That credential allows only the worker endpoints, and only for the workspace that owns the dialled number.
- **Number to workspace:** a phone-number mapping table, added in the call-records migration, approved separately, with RLS like every tenant table.
- **Secrets:**
  - the credential is stored as a worker secret, separate from the JWT secret and the database credentials;
  - provider keys for STT and TTS live only in the worker;
  - the language-model key stays in the API.

### 4. Hosting
The worker needs long-lived processes and WebRTC/SIP networking in a UK or EU region, which rules out serverless functions. Options for the owner:

| Option | For | Against |
|---|---|---|
| LiveKit Cloud (managed SIP and rooms) plus our worker on a container host | Least media operations; SIP included | Per-minute platform fees; another processor for UK GDPR records |
| Self-hosted LiveKit server plus worker (e.g. a UK VM or Kubernetes) | No platform fees, full control of data location | We run and patch a media server; on-call burden |
| Pipecat worker with the telephony provider's media-stream WebSocket (no LiveKit) | Fewer moving parts | More assembly for end-of-turn and barge-in (ADR-0004) |

**Recommendation:** prototype on LiveKit Cloud with the worker on a UK container host, and revisit self-hosting when call volume justifies it.

### 5. Data, privacy and consent
- Per call, store metadata, outcomes, the transcript and per-turn metrics in the call records (Phase 2 item 4). Audio is **not** stored unless the owner enables recording.
- If recording is enabled, play the workspace's existing recording notice at the start of the call.
- Retention follows the workspace setting (7–365 days).
- **Processors** for the record of processing: the telephony provider, LiveKit if cloud-hosted, the STT and TTS providers, and Anthropic. UK/EU data location is preferred wherever a provider offers it.

### 6. Latency budget (targets to verify, not measurements)

| Stage | Target | How it will be measured |
|---|---|---|
| End of caller speech → turn committed (end-of-turn detection + final STT) | ≤ 500 ms | Worker timestamps |
| Turn committed → first text from the brain | ≤ 700 ms p50 | Step 1 `first_text_ms` plus the worker-to-API hop |
| First sentence → first audio from TTS | ≤ 300 ms p50 | Worker timestamps; Step 1 TTS timings |
| **End of speech → first agent audio** | **≤ 1.5 s p50, ≤ 2.5 s p95** | Harness in paid mode, then test calls |
| Caller speaks → agent audio stops (barge-in) | ≤ 300 ms | Worker timestamps |

Also:
- If no audio is ready **~1.5 s** after the turn is committed, play a short filler line ("One moment, I'm just checking that").
- The hard limit per turn falls from 60 s to **~12 s**, ending in the existing recovery line (audit V5).
- These targets are set from what callers tolerate. They will be checked against real measurements before any number is used.

### 7. Failure handling (extends ADR-0004)

| Failure | Worker behaviour |
|---|---|
| Brain endpoint error or timeout | Recovery line, offer to take a message; after two failures, message-taking only |
| STT stream drops | Reconnect once; if it fails again, apologise, take a message by keypad or end politely |
| TTS fails | Switch to a second TTS voice if configured; otherwise apologise and offer a callback |
| Monthly cap reached | Polite message that the line is busy, and record a missed-call callback |
| Worker crash | The telephony provider plays a fallback recording, or forwards to the business number if one is configured |

## Phasing (each step needs the owner's go-ahead)

1. **Approve this ADR**, the hosting option and the processors.
2. **Worker skeleton in CI, no telephony and no paid calls.** The worker plays recorded caller audio through stand-in STT and TTS and the worker brain endpoint against a local API. The harness gains an audio mode.
3. **Paid measurement**, with a small monthly cap you set: one STT, one TTS and the language model on scripted calls (audit step 3, model comparison V4).
4. **A test phone number** with a spending cap. Internal test calls only.
5. **Supervised pilot** with one business.

## Consequences

- **New infrastructure:** a long-running service, LiveKit, and a telephony account. These mean recurring cost and operational work.
- **No receptionist change:** the receptionist's behaviour stays in one tested place, the API.
- **Migration:** the call-records and phone-number migration is needed and is approved separately.
- **Out of scope:** real-time phone calls are not ready until steps 2–4 are done.
