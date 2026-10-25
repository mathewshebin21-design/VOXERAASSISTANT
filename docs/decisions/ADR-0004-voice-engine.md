# ADR-0004: Real-time voice engine

- **Status:** Accepted for Phase 3 (browser voice lab). Provider choices are **proposed** and need owner approval before any paid account is opened.
- **Date:** 2026-10-25

## Context
Phase 3 asks for a modular real-time pipeline with natural turn-taking, streaming, barge-in, silence detection, noise resilience, partial transcripts, tool calls during calls, and graceful recovery from provider failures. It also asks for measured latency, failure rates and cost per minute, with no invented benchmarks, and for a browser voice simulator **before** telephony.

No paid speech or LLM provider is authorised yet, so nothing in this phase may call one.

## Decision

### 1. A provider-agnostic session engine we own
`apps/previews/src/lib/voice/` holds the turn-taking logic behind three interfaces: `SttAdapter`, `BrainAdapter` and `TtsAdapter` (`types.ts`).

- **Turn-taking** (`engine.ts`): idle → listening → caller speaking → thinking → agent speaking.
  - A turn is committed on the recogniser's final result.
  - If the recogniser never sends a final result, the last partial is committed `sttFinalTimeoutMs` after voice activity ends.
- **Streaming:** brain output is consumed while it plays. Text is cut into sentences, and each sentence goes to TTS as soon as it is complete, so the first sentence is heard while later text and tool calls are still arriving.
- **Barge-in:** caller voice activity, a partial transcript of at least `bargeInMinWords` words (an echo guard), or typed input during thinking or speaking will:
  - abort the brain stream;
  - cancel TTS;
  - mark the reply as interrupted;
  - record how long the agent took to stop.
- **Silence:** after `noInputMs` the agent asks once whether the caller is still there. After a second silence it says goodbye and ends the call.
- **Noise:** the energy VAD (`vad.ts`) first calibrates to the room, then adapts its noise floor only while nobody is speaking. Steady noise slowly becomes the new floor. Short clicks are ignored (`minSpeechMs`). Hangover and hysteresis stop pauses within a sentence from ending the turn. The browser's echo cancellation and noise suppression are switched on.
- **Recovery:**

  | Failure | What the engine does |
  | --- | --- |
  | Brain error, or no output within `brainFirstChunkTimeoutMs` | Speaks a fixed recovery line that offers to take a message. |
  | Two brain failures in a row | Switches to a message-taking fallback brain, which can never claim a booking. |
  | TTS failure | Switches to text-only output. |
  | Fatal STT error | Switches to typed input. |
  | Recoverable STT error | Logs it and keeps listening. |

  Every fallback is recorded against the turn.
- **Measurement:** every figure in `TurnMetrics` is measured with `performance.now()`:

  | Metric | Measured from → to |
  | --- | --- |
  | `sttMs` | end of speech (VAD) → final transcript |
  | `brainFirstMs` | transcript committed → first brain output |
  | `ttsFirstMs` | sentence handed to TTS → audio starts |
  | `e2eMs` | end of speech → first agent audio |
  | Time to first audio | call start → greeting audio |
  | `bargeInRecoveryMs` | caller starts speaking → agent audio stops |

  Failure rates are per stage. Cost per minute is the sum of configured per-minute prices, and is `null` (not £0) if any provider has no price configured.

### 2. Browser voice lab first (`/flow/app/voice`)
- Adapters: Web Speech API recognition (continuous, with interim results and auto-restart), `speechSynthesis` with a start watchdog, a text-paced fallback voice, and a microphone VAD.
- The brain is the existing rule-based receptionist, so tools, guardrails, confirmation-before-booking and citations behave exactly as in the simulator.
- Failure drills inject brain errors or hangs and TTS failures from the UI.
- Signed-in owners and admins can save a test call's **metrics only** (no audio, no transcript text) to `voice_test_sessions`. The table has RLS and is append-only for the API role (SELECT, INSERT and DELETE grants; no UPDATE). The API recomputes the summary from the turns instead of trusting the client.

### 3. Production media path: adopt a framework instead of hand-rolling media
For telephony (Phase 4) the recommendation is **LiveKit Agents**, with **Pipecat** as the alternative to prototype against. The engine's interfaces map onto both, so the receptionist brain, tools and guardrails move across and only the transport and media layer changes.

| Option | Strengths (as documented) | Concerns |
|---|---|---|
| **LiveKit Agents** (Python, Apache-2.0) | Built-in telephony and SIP, interruption handling, noise cancellation, and a custom end-of-turn model. Self-hostable server; managed cloud optional. | The turn-detector model may be under a separate model licence (seen only on a third-party copy of the README; check the official repo before relying on it). Running our own LiveKit server is extra operational work. |
| **Pipecat** (Python, BSD-2) | Composable pipeline of services. WebRTC and WebSocket transports, with serializers for Twilio, Telnyx and Plivo media streams. Broad provider plug-ins. | Turn detection and SIP depend on which pieces we choose; more assembly needed. |
| **Realtime speech-to-speech models** (e.g. OpenAI Realtime, Gemini Live) | One hop, naturally low latency, built-in barge-in. | Less control over exact wording, and grounding plus validated tool arguments are harder to enforce. Per-minute pricing needs checking. Vendor lock-in. Kept as an evaluation track, not the default. |
| **Open source** (faster-whisper / whisper.cpp STT, Silero VAD, Piper or Kokoro TTS) | No per-minute fees, data stays in our infrastructure. | Needs GPUs to be fast; streaming STT quality needs testing on UK accents and phone audio. Candidate for later cost reduction. |

Hosted streaming providers to benchmark once approved:
- **STT:** Deepgram, AssemblyAI, Speechmatics (UK-based; relevant for UK accents and data residency).
- **TTS:** Cartesia, ElevenLabs.
- **LLM:** Anthropic, OpenAI.

No latency or price figures are quoted here on purpose. Pricing pages change, and Phase 3 forbids invented benchmarks. Each provider will be measured with this engine's `TurnMetrics`, on the same scripted calls, over real phone audio.

## Consequences
- ✅ Every Phase 3 behaviour is implemented and tested without spending anything: 13 unit tests with fake adapters and fake timers, 5 browser E2E checks, and 1 live E2E check against the API.
- ✅ The voice lab works on the public demo site (no backend needed).
- ⚠️ Browser figures describe the browser's speech engines on that device. They are **not** production benchmarks. In Chrome, recognition is server-based (MDN), which the UI discloses.
- ⚠️ The energy VAD is basic. LiveKit's turn detector or Silero VAD should replace it on the server path.
- ⚠️ The rule-based brain answers almost instantly, so `brainFirstMs` will only become meaningful once a streaming LLM is connected (Phase 5, server-side, keys never in the browser).

## Sources (checked 2026-10-25)
- LiveKit Agents docs: https://docs.livekit.io/agents. Apache-2.0; telephony; turn detection.
- Pipecat docs: https://docs.pipecat.ai. PyPI: https://pypi.org/project/pipecat-ai/. BSD-2; transports and serializers.
- MDN, `SpeechRecognition` (server-based in Chrome): https://developer.mozilla.org/docs/Web/API/SpeechRecognition
- MDN, `SpeechRecognition.processLocally` (experimental): https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally
