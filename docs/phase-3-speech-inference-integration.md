# Phase 3 — Speech component wiring (not activated)

**Status:** code-level integration only. No STT/TTS provider calls, LiveKit rooms, paid services, telephone calls, or production environment changes are included in this PR.

## Pipeline

When explicitly enabled in an independently approved environment, the LiveKit session will use:

1. **STT:** `inference.STT(model=VOXERA_STT_MODEL)`
2. **Reasoning:** VOXERA's existing scoped `/v1/worker/live/brain` streamed API, via `VoxeraAgent.llm_node` (no duplicate LLM instance is created inside LiveKit)
3. **TTS:** `inference.TTS(model=VOXERA_TTS_MODEL, voice=VOXERA_TTS_VOICE)`
4. **VAD:** `inference.VAD(model="silero")`

LiveKit handles turn detection, interruptions, and media. Provider-specific token and usage expenses **are not** controlled by the VOXERA brain's LLM token budget. A vendor-side hard spending limit must be independently configured and verified before enabling inference, and region restrictions must be set in LiveKit Cloud if UK/EU residency is required.

## Explicit configurations (example values only)

```text
VOXERA_MEDIA_ENABLED=false
VOXERA_MEDIA_PROVIDER=livekit-inference
VOXERA_STT_MODEL=deepgram/nova-3:multi
VOXERA_TTS_MODEL=cartesia/sonic-3
VOXERA_TTS_VOICE=your-approved-voice-id
```

`VOXERA_MEDIA_ENABLED=true` is only used by isolated tests with mocked model constructors and fake media sessions. The shipping **staging** container refuses to start with paid media inference enabled, so it is not usable for real audio until a distinct authorized enablement review. `VOXERA_SIP_ENABLED=false` remains mandatory for staging.

The speech model values must be explicit provider/model descriptors; an empty or malformed model, missing voice, unrecognized provider or omitted enablement flag prevents the worker from opening a call record.

## Verification scope

- Pure configuration tests (including missing values, malformed model names and omitted enablement).
- Worker entrypoint tests: refuse an unconfigured simulated call before creating a record, preserve SIP channel/auth checks, and maintain media startup failure cleanup.
- Build LiveKit `AgentSession` with mocked `inference.STT/TTS/VAD` constructors; assert correct models and that the VOXERA API remains the only reasoning engine.
- Real `livekit-agents` package installed in GitHub CI; existing adapter and Docker build checks preserved.
- No actual audio or measured latency is claimed.

## Before staged audio can be activated

- Written choice of actual LiveKit environment, STT provider, TTS provider and voice(s), with priced monthly and per-minute hard caps.
- Workspace language/voice policy, routing and tenant isolation; current static environment model selection is **not** a tenant-specific voice policy.
- Non-telephone media tests in an isolated LiveKit room, with production endpoints inaccessible.
- Record and validate actual STT final transcripts, TTS voice quality, first-audio latency, barge-in, interruption recovery, concurrency and usage.
- AI notice, recording consent, data residency and processor contracts; country launch gates and emergency behavior.
- Independent owner approval before changing the staging media gate or connecting any paid provider.

**Never set enabled media or SIP flags in production or shared staging solely to test code.**
