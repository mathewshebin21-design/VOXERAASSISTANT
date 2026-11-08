# ADR-0006: VOXERA Global — multilingual, provider-independent voice architecture

- **Status:** Proposed. The foundation is implemented on `claude/phase2-global`. No paid provider, telephony or production change is involved.
- **Date:** 2026-11-08
- **Builds on:**
  - ADR-0004 (voice engine adapters);
  - ADR-0005 (voice worker; the worker calls the API's brain);
  - the Phase 2 voice audit.

## Context

VOXERA has to answer calls for businesses in many countries and languages, without:
- a separate codebase per industry or language;
- handing its receptionist logic to a single vendor.

Today the receptionist works in English through the browser Voice lab:
- the brain, tools, booking confirmation, caps and tenancy are in the API;
- speech recognition and speech output are browser or on-device adapters, with ElevenLabs optional;
- there is no telephony and no server-side speech recognition.

## Decision

### 1. One brain, many pipelines
- **The brain stays in the VOXERA API.** That covers the prompt, tools, confirmation rules, tenancy, caps and audit.
- Everything else is an interchangeable adapter: speech-to-text, the reasoning model, text-to-speech, real-time transport and telephony.
- The voice worker (`services/voice-worker`) is a media shell. It holds the per-call session and speaks what the brain returns.
- No provider adapter may contain receptionist logic. This is what keeps VOXERA from becoming a thin wrapper around Vapi, Retell or LiveKit.

### 2. Language registry with evidence levels (`app/voice/languages.py`)
- **Locales are BCP 47.** The first set is en-GB, en-US, en-IN, hi-IN, ml-IN, ar-SA, ar-AE and ar-EG.
- **Each provider declares, per language, an evidence level:**
  - `tested`: VOXERA ran its own scenarios and recorded the results;
  - `advertised`: the vendor's documentation lists it;
  - `unverified`: no vendor statement found;
  - `unsupported`.
- **Nothing is `tested` today.** That requires an approved real-model and real-audio run (Sprint E). The API reports these levels (`GET /v1/orgs/{org}/voice/languages`), so no screen can present advertised support as proven.
- **Development targets:** English, Hindi, Malayalam and Arabic. These are targets, not supported languages.

### 3. Policy-first routing (`app/voice/routing.py`)
`select_route(language, policy, available)` picks speech-to-text, the model and text-to-speech.

**Hard rules, which no fallback may relax:**
- every region where a provider processes data must be allowed by the workspace;
- the provider must not be blocked;
- paid providers need the workspace's consent;
- the provider must be integrated and configured;
- only `tested` or `advertised` support counts, unless the workspace allows `unverified` routes for internal testing.

**Fallback.** If the caller's language has no compliant route, the workspace's fallback language is tried. The route records why (`language_fallback`, `reasons`), so the receptionist can say so honestly.

**Ranking:** evidence, then streaming, then workspace preference, then free over paid. The result is deterministic.

**Route preview.** `POST /v1/orgs/{org}/voice/route` shows the decision without calling anything.

### 4. Language detection and switching
- **When a call switches.** `LanguageState` (API) and `LanguageGate` (worker) switch only after two consecutive confident detections (≥ 0.8) of a language the workspace accepts. A single greeting is not enough.
- **Manual choice wins.** A caller's own choice, by keypad or by asking, overrides detection.
- **Context is kept.** Conversation history is never rewritten on a switch.
- **No translation layer.** The brain gets `language` per turn, and the model replies directly in that language, so there is no machine translation in between.
- **Caching unaffected.** The language line goes after the prompt-cache breakpoint, so the cached prefix is unchanged; this is tested.

### 5. Adapter contracts
| Adapter | Contract | Where |
|---|---|---|
| Speech-to-text | Streaming text, end-of-turn signal, detected language and confidence per utterance | Browser `SttAdapter` (`apps/previews/src/lib/voice/types.ts`); server-side through LiveKit plugins in the worker |
| Reasoning | `POST /live/brain`: history, `conversation_id`, `language` in; SSE text, tool, hand-off, error and done (with metrics) out | API; worker `BrainClient` |
| Text-to-speech | Sentence in, audio stream out, cancellable | Browser `TtsAdapter`; LiveKit TTS plugins in the worker |
| Real-time transport | Long-lived two-way audio per call, barge-in | LiveKit Agents (`voxera_worker/livekit_agent.py`) |
| Telephony | Inbound number → workspace, transfer, voicemail fallback | Not built (ADR-0005 phase 4); needs the number-mapping migration |

### 6. Technology evaluation

These are assessment criteria. **No latency or cost figure here is measured.** Vendor figures are not accepted as benchmarks; the harness and the worker produce the measurements once a paid run is approved.

| Option | Type | For | Against | Status |
|---|---|---|---|---|
| **LiveKit Agents** | Open-source framework, self-host or Cloud | VOXERA keeps the brain. SIP support. Plugin ecosystem for STT and TTS. The adapter is proven against the real package | We operate it (or pay for Cloud). More engineering | **Preferred.** Prototype built |
| Pipecat | Open-source framework | Similar control | More assembly for turn-taking (ADR-0004) | Alternative |
| Vapi / Retell / Bland | Managed voice orchestration | Fastest to a working phone call | Logic and data sit in a third party. Per-minute platform fees. Lock-in. VOXERA's tools would need a custom bridge | Possible **pilot accelerator only**, behind the same brain endpoint, if the owner prioritises speed |
| RingCentral, GoTo, Genesys, PolyAI | Incumbent products | Benchmarks for features and expectations | Competitors, not components | Benchmarks only |

**Comparison method once approved (Sprint E).** The same harness scenarios run per stack, measuring:
- time to first audio;
- end-of-turn latency (p50 and p95);
- barge-in recovery;
- tool accuracy;
- language accuracy per locale;
- transfer success;
- cost per completed call.

### 7. Country and region constraints

No country is "supported" until its full call flow has been tested. Before a country goes live, each needs:
- a licensed number or SIP provider in that country;
- the local rules on recording and AI disclosure, and how emergency calls are handled;
- data-transfer rules (for example UK and EU GDPR adequacy, India's DPDP Act, Gulf data-residency expectations);
- the local emergency number, wording and transfer behaviour.

**Hard-coded UK assumptions to remove before non-UK pilots:**
- the receptionist prompt says "999 / NHS 111", "pounds" and "patch test";
- prices are in GBP;
- the default time zone is Europe/London.

They become workspace and locale configuration.

### 8. Data and security
- Workspace isolation, RLS, tool authorisation, caps and audit are unchanged.
- **The worker currently authenticates with an operator-supplied member token** (prototype only). Before any hosted worker, a scoped, signed service credential (ADR-0005 §3) is required.
- Call records (PR #28) store transcripts only when the recording notice was played, and never store audio.

## Consequences

- New languages and providers are registry entries plus adapters, not code forks.
- The data-residency rule is enforced in one tested function.
- **Honest status everywhere.** Advertised support is never shown as tested.

**Not built:**
- telephony;
- server-side STT and TTS integrations;
- the worker service credential;
- persisting workspace voice policy (needs a migration);
- real measurements.

## Approvals needed (not requested by this ADR's implementation)

1. Paid model, STT and TTS keys with enforceable monthly caps (Sprint E).
2. LiveKit hosting: Cloud or self-hosted, and the UK container host for the worker.
3. A telephony provider and test number.
4. Migrations: workspace voice policy, number-to-workspace mapping, and call records (PR #28, already proposed).
