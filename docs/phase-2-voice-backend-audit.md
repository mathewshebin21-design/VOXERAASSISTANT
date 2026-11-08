# Phase 2: voice backend audit

Date 2026-11-08. Production baseline `d105658`. **Method: code reading only.** No paid provider was
called and no latency was measured for this audit. Every figure below comes from the code or
from published price lists, and nothing is a benchmark.

## 1. What exists today

```
Browser (Voice lab, /flow/app/voice)                 API (FastAPI on Vercel, Python)
  mic → VAD (vad.ts) → browser STT ──text──▶  POST /v1/orgs/{id}/live/brain  (SSE stream)
  engine.ts: turn-taking, barge-in,             ├─ budget.reserve (worst case for the turn)
  silence, echo guard, recovery                 ├─ Claude (beta.messages.stream) or an
  ◀── text deltas (SSE) ───────────────────     │   OpenAI-compatible provider, up to 6 tool rounds
  sentence splitter → TTS:                      ├─ tools: availability, booking, hand-over …
    browser voice / on-device Kokoro, or        └─ budget.settle (actual usage)
    POST /live/tts (ElevenLabs, MP3 stream) ──▶  POST /v1/orgs/{id}/live/tts  (per sentence)
```

| Part | Where | Notes |
|---|---|---|
| Turn-taking engine | `apps/previews/src/lib/voice/engine.ts` | Provider-agnostic `SttAdapter` / `BrainAdapter` / `TtsAdapter` (ADR-0004); 292-line unit test file |
| Speech-to-text | Browser only (`browser.ts`) | No server STT. That arrives with telephony (Phase 4), where the audio is on the server |
| Brain | `services/api/app/routers/live.py` `/brain`, `app/live/receptionist.py` | Anthropic (default) or Groq, Gemini, OpenRouter, Ollama, any OpenAI-compatible endpoint (`app/live/providers.py`) |
| Text-to-speech | Browser voice, on-device Kokoro, or ElevenLabs via `/tts` | ElevenLabs `eleven_flash_v2_5`, MP3 44.1 kHz/128 kbps, one HTTP request per sentence |
| Spending control | `app/live/budget.py` | Monthly caps in provider **units** (tokens, characters) per workspace and globally; advisory-locked reservation, then settle. A cap of 0 disables a provider (the default) |
| Recorded sessions | `app/routers/voice.py` | Voice-lab test sessions with metrics, workspace-scoped |

The client already measures, per turn: `sttMs`, `brainFirstMs`, `brainTotalMs`, `ttsFirstMs`, `e2eMs` and
`bargeInRecoveryMs` (`types.ts`). **No server-side timing is recorded**, and no live-provider
measurement has been run, because no provider key is configured.

## 2. Findings

Severity: **H** = fix before any live customer call; **M** = fix before telephony or real
spend; **L** = improvement.

| # | Sev | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| V1 | **H** | **Serverless HTTP cannot carry a phone call.** The brain is an SSE response from a Vercel Python function and TTS is a separate request per sentence. A phone call needs one long-lived, two-way audio connection (WebSocket or WebRTC) with server-side STT, which Vercel functions do not host | `live.py` `StreamingResponse`; ADR-0004 step 3 already names LiveKit Agents or Pipecat | Decide the media layer before Phase 4: a separate long-running voice worker (LiveKit Agents or Pipecat) that calls the same booking and tool code (`reception.py`) and the same budget. Keep Vercel for the dashboard and REST API |
| V2 | M | **No prompt caching.** Every model round resends the full tool list and system prompt, up to 6 rounds per caller turn and many turns per call, all billed at full input price | No `cache_control` anywhere under `services/api/app` | Add a cache breakpoint after the tools and the stable part of the system prompt. Verify with `usage.cache_read_input_tokens`. No quality trade-off |
| V3 | M | **The system prompt ends with the current time to the minute**, so a cached system prompt would be invalidated every minute | `receptionist.py:131` `It is now {local:%A %-d %B %Y, %H:%M}` | Split `system` into two blocks: the stable instructions (cached) and a final "It is now …" block after the breakpoint. Tools and instructions then stay cached across turns and calls |
| V4 | M | **Default model choice for a real-time route is untested.** The default is `claude-opus-5-5` at effort `low` (set explicitly, which is correct: this model's default is `medium`). Thinking cannot be switched off on this model, so time to first word must be measured, not assumed | `config.py` `model` property; `llm_effort="low"` | Keep the default (model choice is the owner's decision). In the measurement step, compare `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` on the same scripted calls for first-word latency, tool accuracy and cost, then decide. Note that Haiku rejects the server-side fallback parameter; the code already handles that |
| V5 | M | **The turn deadline is 60 s**, far longer than a caller waits in silence | `live.py` `TURN_DEADLINE_S = 60.0` | For telephony, a short filler line ("One moment while I check that") after ~1.5 s with no audio, and a hard deadline of ~10–15 s per turn ending in the recovery line |
| V6 | M | **TTS opens a new HTTP connection per sentence**, adding connection set-up to every sentence's first audio | `providers.tts_http()` creates a client per request | Reuse one client per call; for telephony use the provider's streaming-input WebSocket so text flows in as it is generated |
| V7 | M | **No server-side latency or failure metrics**, so p50/p95 and provider error rates cannot be reported | Only client metrics (`types.ts`); logs record errors but not timings | Log per turn: time to first token, rounds, tool latency, tokens in, cached and out, and the provider status. Build the scripted-call harness (ADR-0004 step 2) against the existing stand-in providers first |
| V8 | L | **Caps are in units, not money**, by design: VOXERA does not know prices or currency | `budget.py` docstring | Keep it. Also set a hard monthly spend limit in each provider's console, as the docs already say. A dashboard estimate (units × list price) would help the owner |
| V9 | L | **TTS is charged before the call**, so a failed synthesis still counts | `live.py` `/tts` docstring | Fine: it fails safe. Note it in the usage page wording |
| V10 | L | **Retries and timeouts:** one retry, 30 s read / 5 s connect timeout for the model; 20 s for TTS | `providers.py` | Reasonable for a lab; for calls, tie timeouts to the per-turn deadline (V5) |

## 3. Security

| Area | Status |
|---|---|
| Provider keys | Server-side only (`SecretStr`), never returned by any endpoint (`config.py` comment, `providers.py`) |
| Who can spend | `/brain` and `/tts` need `agent_write`; the setup assistant has its own permission (`_setup_perm`) |
| Spending runaway | Per-workspace and global monthly caps with concurrency-safe reservation; caps default to 0 (off) |
| Tool safety | Tool names and arguments are validated against their schemas before running (`toolcheck.py`); booking changes require the caller's clear "yes" (`_need_yes`) |
| Prompt injection | The receptionist prompt tells the model not to change its role, reveal its instructions or act outside the business's reception (`receptionist.py:129`). Instruction-only, so worth adversarial cases in the harness. Deterministic safeguards exist only in the Agent Studio engine (PR #2, not merged) |
| Refusals | `refusal` stop reason handled, with server-side fallback on supported models |
| Open | Call audio and transcripts are not yet stored server-side. Retention, consent ("this call may be recorded") and UK GDPR handling must be designed with call records (Phase 2 item 4); a recording notice already exists in workspace settings |

## 4. Costs

VOXERA counts units, so the cost of a call depends on prices set outside the code. List prices at
the time of writing are in USD per million tokens (input/output): Claude Opus 5.5 $4/$20, Sonnet 5.5 $2/$10,
Haiku 5.5 $0.10/$0.50. Cache reads cost about a tenth of the input price, which is why V2 matters:
the tool list and instructions make up most of each request. ElevenLabs bills per character on its own
plans.

**No cost per call is estimated here**, because no real call has been measured. The harness (V7) should
report tokens and characters per scripted call, which turns into a cost per call at whatever prices
apply then.

## 5. Recommended order (no production migration, no paid provider)

1. **V2 + V3 (caching)** and **V6 (TTS client reuse)**: small code changes, testable against the
   stand-in providers in CI; caching is verified once a provider is approved.
2. **V7 (server timing and harness)**, so later choices rest on measurements.
3. **Owner decision: approve one test provider key with a small monthly cap**, then run the harness
   for V4 (model comparison) and real latency figures. No customer data.
4. **V1 + V5 (media layer design)**: an ADR for the voice worker (LiveKit Agents or Pipecat), server STT
   and the telephony provider. No number is bought and no call is placed without the owner's approval.

## 6. Decisions for the owner

| Decision | Why it is yours |
|---|---|
| Whether to approve a test provider key (and its monthly cap) for measurements | It spends money |
| Which model the receptionist uses after measurement (V4) | Quality, cost and latency trade-off |
| Voice worker hosting and telephony provider (V1) | New infrastructure and recurring cost |

## 7. Step 1 results: V2, V3, V6 and part of V7 (branch `claude/phase2-voice-step1`)

| Finding | Change | Evidence |
|---|---|---|
| V2 no prompt caching | The system prompt is sent as blocks: the stable instructions carry a cache breakpoint, which also covers the tool definitions sent before them | `test_live.py`: the request's first system block has `cache_control`, and the second round of a turn resends the identical tools and first block |
| V3 clock in the prefix | The clock line (`CLOCK_LINE`) goes after the breakpoint | `test_cached_prefix_is_identical_at_different_times`: the cached block is byte-identical at 09:00 and 16:47 |
| V6 a connection per sentence | One Anthropic, one OpenAI-compatible and one TTS client per server process (thread-safe, keep-alive 15 s, a rotated key gets a new client). Requests close only their own response, including on errors and when the listener stops early | `test_each_provider_client_is_created_once_per_process`; `test_tts_reuses_one_client_and_releases_each_response`. Local live suite: 5 TTS sentences used 1 client (before: 5); 2 brain turns used 1 Anthropic client |
| V7 metrics (part) | Each turn logs and returns in its `done` event: rounds, uncached input, cache read and write, output tokens, time to first text, tool time, total time and clients created. Each TTS request logs time to headers and first byte, bytes, completion and clients. Logged under one allow-listed `metrics` key (numbers and flags only, never text) | `test_cache_hits_are_reported_and_still_counted_against_the_cap`, `test_openai_compatible_cached_tokens_are_reported`, `test_metrics_reach_the_json_log_and_nothing_else_does` |

Unchanged on purpose: the default model, effort `low`, the monthly caps (cached tokens still count
toward the cap, conservatively), authentication, tool permissions, the prompt-injection instructions,
and streaming error handling. No migration.

**Limitations:**
- A real cache hit has not been observed. The stand-in provider used in CI reports no cache figures, and seeing one needs a paid call, which is held for owner approval.
- Whether the cached prefix reaches the model's minimum cacheable length is unconfirmed until that call; with the receptionist's tool list and instructions it is expected to.
- Connection reuse helps only while a serverless instance stays warm. A cold start creates new clients.
