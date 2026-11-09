# Phase 2 → Phase 3: isolated LiveKit entrypoint rehearsal

**Status:** proposed non-production test coverage. **Not a real telephone call.**
**Baseline:** production source `4a0a421`, schema `0011`.

## What is exercised

The test imports the actual `livekit-agents` package and runs
`voxera_worker.livekit_agent.entrypoint` with an inert `JobContext`,
`AgentSession`, and call-recorder double. It has no LiveKit server, SIP
trunk, microphone, audio synthesis, paid provider, API credentials, or
outbound network requests.

| Test scenario | Required outcome |
| --- | --- |
| SIP participant plus test/simulated token | Refuse before recording or media startup |
| SIP participant plus live token for the wrong channel | Refuse before recording or media startup |
| SIP participant plus live/phone token but API denies call creation | Refuse before any media startup |
| SIP participant plus live/phone token and API-authorized call ID | Start media only after the record exists; register shutdown finalization |
| Non-SIP participant plus phone token | Refuse before media startup |
| Simulated non-SIP participant plus test/simulated token | Best-effort recording may fail without blocking simulated session |

A fabricated JWT-shaped token is used **only** to exercise the worker's
local channel checks. The signature is **not verified** here: the real
API verifies it when accepting or refusing call creation. A fake record ID
represents that external authorization in the approved branch.

The test does **not** establish that speech is audible, that STT or TTS
works, that a caller can interrupt speech, that a SIP call routes to the
right workspace, or that any country is ready for live calls.

## Run locally without commercial services

```bash
cd services/voice-worker
uv sync --extra livekit
uv run --extra livekit pytest -q tests/test_livekit_entrypoint.py
```

The `voice-worker` GitHub Actions workflow runs these tests on every
worker-related pull request. Existing API / hosted acceptance tests remain
separate.

## Gates before real phone testing

1. **Tenant routing:** review and approve a dedicated phone-number → workspace
   mapping migration with tenant RLS, uniqueness rules, and negative tests
   for cross-tenant dialing. Do not infer ownership from caller metadata.
2. **Worker identity:** signed, short-lived, workspace-scoped worker credentials;
   physical SIP-channel checks; API-side country and launch gate; fail closed
   when a token refresh or a record-creation request is refused.
3. **Media runtime:** owner-selected persistent UK/EU worker host, LiveKit
   control plane (cloud or self-hosted), encrypted credentials, health checks,
   restart and concurrency limits.
4. **Provider budget:** explicit owner approval of STT/TTS/model/telephony
   providers and spending caps; vendor-side hard caps as well as VOXERA
   accounting. No live API keys in a public PR or CI logs.
5. **Caller experience:** actual AI and recording notices; no transcript
   retention without required disclosure; recovery, escalation, recording
   erasure and retention verified end-to-end.
6. **Launch jurisdictions:** vetted emergency handling, legal/recording
   consent and language-specific acceptance for each target country.
7. **Measured quality:** record first-audio latency, barge-in behavior,
   interruption recovery, transfer outcome and call termination; do not
   promote ADR latency targets to measured results.

**Release policy:** isolated tests can proceed without paid providers.
No live SIP answering, purchased numbers, paid calls, provider credentials,
production migrations, or production releases without separate owner
approval and a documented rollback plan.
