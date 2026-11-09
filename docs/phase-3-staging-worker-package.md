# VOXERA Phase 3: staging-only voice-worker container

**Status:** buildable staging worker proposal; no cloud host, LiveKit room, telephone number, audio providers or paid account has been provisioned. This is NOT authorization to accept SIP callers.

## Why a separate service

The FastAPI API on Vercel serves short-lived requests. LiveKit Agents needs a separate long-running container for real-time audio. This image packages the existing `voxera_worker.livekit_agent` module from the reviewed Phase 2 branch without changing the production API.

The image runs as uid 10001, installs its dependency lock with `uv sync --frozen --no-dev --extra livekit`, and does not include local `.env` files or secrets. Its entrypoint is `python -m voxera_worker.launch_staging start`, not a shell command. There is no publicly exposed port required for normal LiveKit worker registration.

**Only isolated staging:** The runtime preflight refuses to launch unless:

1. `VOXERA_WORKER_ENV=staging` and `VOXERA_SIP_ENABLED=false` exactly.
2. `VOXERA_API_URL` uses HTTPS, its hostname equals `VOXERA_STAGING_API_HOST`, and it is not a known production alias. The staging hostname must be confirmed out-of-band from the Vercel project's isolated staging deployment.
3. `LIVEKIT_URL` uses WSS and its hostname equals `VOXERA_STAGING_LIVEKIT_HOST`.
4. LiveKit credentials are supplied from the runtime secret manager, never committed.
5. `VOXERA_WORKER_TOKEN_CMD` is configured for a rotating, scoped test token; a static `VOXERA_WORKER_TOKEN` is forbidden.

Additionally, the actual media entrypoint refuses every SIP participant by default, even if it somehow receives a plausible live-phone token. Only the literal `VOXERA_SIP_ENABLED=true` can reach the existing token-and-API authorization path. **Do not enable this in staging.** Enabling real phone calls requires a distinct production deployment design, launch approval, number-to-workspace mapping and legal review.

These checks are defense-in-depth, **not a proof of network isolation**. The host must separately restrict access to the correct Vercel API and staging LiveKit control plane, and protect env variables with runtime permissions. A hostname allowlist is not proof that a domain is safely configured.

## Build/test locally (without provider accounts)

From repository root:

```bash
docker build -f services/voice-worker/Dockerfile -t voxera-staging-worker:local services/voice-worker

# Deliberate refusal, no network:
docker run --rm --network none voxera-staging-worker:local \
    /srv/.venv/bin/python -m voxera_worker.launch_staging check
```

The `voice-worker` GitHub workflow builds the image, checks it refuses missing configuration and enabled SIP, and verifies that a fully populated **dummy** staging configuration passes in an offline container. This is a packaging test only: `check` never launches the agent or calls providers.

## Operator checklist before deploying any staging worker

- Choose a UK/EU-region, continuously running container host or the LiveKit Cloud worker deployment route; select an isolated project and confirm the price.
- Create **staging-only** LiveKit credentials, no production or telephony trunk credentials.
- Confirm the API staging domain, staging database claim and schema `0011`; separate production from staging Vercel environment settings.
- Create a scoped, short-lived **simulated-channel** worker-token minting path in the staging environment. The existing CLI helper is development-oriented; security review is required before running it in a hosted worker.
- Inject the nine required settings through the provider secret manager; never add real values to GitHub files, CI logs, Docker build args or PR comments.
- Enable egress controls, audit trails, restart policy, memory/CPU limits, and alerting. Do not add phone numbers or SIP trunks.
- Verify the deployed process registers with the correct isolated LiveKit project **without accepting real calls**.
- Subsequently, select STT/TTS/VAD providers and model caps, then run media/audio simulation with test rooms. This source currently creates an `AgentSession()` **without STT/TTS/VAD plugins**, so a deployed process alone will not provide spoken conversations.
- Hold production release until full phone call tests, recording notice and per-country emergency/legal launch gates are verified.

## Unaddressed prerequisites

Provider integration for STT/TTS/VAD, phone-number-to-workspace mapping, host provisioning, real measured end-of-speech latency, barge-in, language switching from real STT, human transfer, paid budget control and jurisdiction-specific approval remain separate work.

**Change control:** no production release, no DB migrations, no paid calls, no phone number purchase, and no deletion of backups or old validation infrastructure through this package PR.
