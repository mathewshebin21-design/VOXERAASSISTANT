# Live providers: connecting a real AI brain and voice

**Status:** built and tested against local fakes of each provider's API. **No real provider has been called.** The live providers stay switched off until you add API keys **and** monthly caps.

## What it does
In the Voice lab (`/flow/app/voice`), a signed-in owner or admin can switch on:

| Switch | Provider | What runs on the server |
|---|---|---|
| **Claude as the brain** | Anthropic Messages API (streaming) | A receptionist prompt with three read-only tools over **your workspace's own data**: business info, opening hours and services. It runs at low effort, with server-side refusal fallback (`fallbacks: "default"`) and at most three model rounds per caller turn. It cannot book, cancel or take messages yet (scheduling is Phase 7), and it says so. |
| **ElevenLabs voice** | ElevenLabs streaming TTS (`eleven_flash_v2_5`, MP3) | Synthesises one sentence at a time, so speech starts before the whole reply is ready. |

Speech recognition stays in the browser for now. Server-side STT arrives with telephony (Phase 4), where the call audio is on the server anyway.

## Safety and cost controls
- **Keys:** read only by the API, from environment variables. They are never sent to the browser or returned by any endpoint (tested).
- **Two caps per provider:** a monthly cap per workspace and a global monthly cap across all workspaces (UTC calendar month).
  - A cap of 0 switches that provider off.
  - Each request is checked against its worst case before the provider is called. Actual usage is recorded afterwards as `live` usage events, visible on the Usage page.
  - The global total is computed by a locked-down database function. A workspace can't see any other workspace's usage.
- **Overshoot:** concurrent requests can each pass the check, so a cap can be exceeded by at most (concurrent requests × one request's maximum).
  - For the LLM, one request's maximum is about 3 × (history + 2,500 + 400 output) tokens.
  - For TTS it is one sentence, at most 600 characters.
  - **Also set a hard spending limit in each provider's console.**
- **Barge-in:** when the caller interrupts, the browser aborts the request and the API stops reading from the provider. Tokens produced up to that point are still metered.
- **Failures:** provider errors, rate limits and refusals become an error event. The engine then speaks its recovery line, and after two failures in a row switches to the message-taking fallback. A failed voice falls back to text.
- **Privacy:** transcripts are not stored, only usage counts. The Voice lab tells the user when their words are sent to the live providers.

## Turning it on (owner's steps — needs your accounts and your money)
1. Create an Anthropic API key at console.anthropic.com and set a monthly spend limit there.
2. Create an ElevenLabs API key and choose a voice ID, then check your plan's character allowance.
3. In `services/api/.env`, which is never committed (see `.env.example`), set:
   ```
   VOXERA_ANTHROPIC_API_KEY=...
   VOXERA_LIVE_LLM_TOKENS_PER_ORG_MONTH=200000
   VOXERA_LIVE_LLM_TOKENS_GLOBAL_MONTH=200000
   VOXERA_ELEVENLABS_API_KEY=...
   VOXERA_ELEVENLABS_VOICE_ID=...
   VOXERA_LIVE_TTS_CHARS_PER_ORG_MONTH=20000
   VOXERA_LIVE_TTS_CHARS_GLOBAL_MONTH=20000
   ```
4. Restart the API (`docker compose up`, or `uv run uvicorn app.main:app`). The Voice lab now shows the two switches with the allowance left.

**What a cap costs at most, from Anthropic's list prices** (per million tokens; snapshot of 2026-10-06, so check current pricing):
- The model defaults to `claude-opus-5-5` ($4 input / $20 output). A 200,000-token monthly cap can't cost more than 200,000 × $20 / 1,000,000 = **$4.00**, even if every token were output. Most tokens are input, so the real cost is lower.
- `VOXERA_LLM_MODEL=claude-haiku-5-5` ($0.10 / $0.50) is faster and much cheaper, but less capable. The same cap then costs at most **$0.10**. Haiku 5.5 has no server-side refusal fallback, so VOXERA leaves that parameter off for it. `claude-sonnet-5-5` ($2 / $10) sits in between, at most $2.00. Which model to use is your decision.
- I haven't checked ElevenLabs prices. Work out the cost from your plan's price per character × the character cap.

## Hosting
The public demo on Vercel has no API behind it, so these switches only appear when the web app is connected to a running API (local Docker, or a hosted API). Hosting the API and database costs money and needs your approval.

## Verification (2026-10-26)
- **API tests:** 70 pass; 8 are new for live providers. Anthropic and ElevenLabs are faked at the HTTP transport layer. The tests check:
  - both providers are off without keys or caps;
  - streamed text plus a tool round-trip on real workspace data, and the exact token count metered;
  - request shape: model, `fallbacks: "default"` with its beta header, effort, no sampling parameters, and an opening user turn;
  - provider errors become error events;
  - validation;
  - the per-workspace cap, and the global cap across workspaces;
  - TTS request shape, audio passed through and characters metered;
  - roles and tenant isolation, and no key in any response;
  - the greeting comes from the saved agent.
- **Live E2E (23/23):** a browser drives the Voice lab with both live switches on, through the Next proxy and the API, to `scripts/fake_providers.py`. The agent called `list_services`, answered with the workspace's real service, played the ElevenLabs-path audio, and both meters rose on the Usage page. CI runs the same test.
- **Not verified:** the real Anthropic and ElevenLabs endpoints. There are no keys here, and the request formats were checked against SDK and docs, not live calls. The first run with your keys is the real test.
