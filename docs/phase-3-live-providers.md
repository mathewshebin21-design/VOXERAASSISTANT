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
  - **Caps are units, not money.** They count LLM tokens and TTS characters. VOXERA does not know provider prices or exchange rates, so it cannot enforce a monetary limit. `GET …/live/status` says so in `limit_note`. **Always set a hard spending limit in each provider's own console as well.**
  - **Enforced by reservation** (migration 0006, `app/live/budget.py`). Before a provider call, the API takes a per-kind Postgres advisory lock, counts recorded usage plus every open reservation (this workspace and all workspaces), and inserts a reservation for the call's worst case. Then it releases the lock. Simultaneous requests, on any number of serverless instances, are serialised by the lock, so together they cannot reserve more than the cap (tested with 12 parallel requests, and the test fails if the lock is removed).
  - When the call ends (normally, on error, or when the caller hangs up), the reservation is swapped for the actual usage in one transaction. If a worker crashes before that, the reservation keeps counting at its worst case. That fails safe: budget is under-used, never over-spent.
  - The LLM worst case for one caller turn is every round (up to 6) re-reading the prompt plus 1,500 tokens of tool data per round, plus the maximum output. The stream also enforces this per round. Usage reported by the provider can slightly exceed the estimate, and the actual figure is always what gets recorded.
  - TTS is charged atomically before the call (lock, check and record in one transaction).
  - Each `request_id` can be used once. A replay gets 409 instead of a second, un-metered provider call.
  - The global total is computed by locked-down database functions (`live_usage_total`, `live_reserved_total`). A workspace can't see any other workspace's usage.
- **Barge-in:** when the caller interrupts, the browser aborts the request and the API stops reading from the provider. Tokens produced up to that point are still metered.
- **Untrusted streams:**
  - Every streamed chunk from an OpenAI-compatible provider is shape-checked. Malformed JSON, NaN/Infinity, wrong types, oversized or out-of-range tool calls, and mid-stream `error` events all end the turn with an error event.
  - A reply counts as complete only with a finish reason or `[DONE]`. A cut connection is reported, and any half-received tool call is never run.
  - `length` (cut-off) and `content_filter` finishes are reported, not accepted as complete. The same applies to Claude's `max_tokens` and `refusal`.
  - A caller turn has a 60-second deadline across all rounds, and is stopped if the model is still calling tools after 6 rounds.
  - Any unexpected exception becomes an error event (logged server-side) instead of a broken response.
- **Model tool calls are validated before anything runs** (`app/live/toolcheck.py`, both providers):
  - the tool name must be one offered on that endpoint;
  - the arguments must be a JSON object matching the tool's schema exactly: no unknown fields, all required fields, correct types, enum values, finite numbers, bounded strings and arrays.
  - A rejected call is reported back to the model ("nothing was done") so it can recover. A tool that crashes is rolled back and reported as an internal error, without leaking details.
  - Tools still check meaning themselves: dates, the caller's ownership of a booking, and explicit consent. One "yes" now confirms one booking change.
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

## Other AI models: Groq, Google Gemini, OpenRouter, Qwen on your own machine

Claude is the default, but the brain can be any provider with an OpenAI-compatible chat API. The receptionist, the setup assistant's AI chat and the practice calls in Simulate all use whichever is configured. They all keep the same tools over the workspace's own data, the same monthly caps, and the same rule of never making up prices or times.

Set these on the **voxera-api** project in Vercel (Settings → Environment Variables), then redeploy it:

| Setting | Groq | Google Gemini | OpenRouter | Ollama (e.g. Qwen on your own computer) |
|---|---|---|---|---|
| `VOXERA_LLM_PROVIDER` | `groq` | `gemini` | `openrouter` | `ollama` |
| `VOXERA_LLM_API_KEY` | key from console.groq.com | key from Google AI Studio | key from openrouter.ai | not needed |
| `VOXERA_LLM_MODEL` | a model ID from Groq's model list | a Gemini model ID from Google's model list | a model ID from OpenRouter's list | the model you pulled, e.g. `qwen3.5:27b` |
| Caps (as for Claude) | `VOXERA_LIVE_LLM_TOKENS_PER_ORG_MONTH`, `VOXERA_LIVE_LLM_TOKENS_GLOBAL_MONTH` | same | same | same |

- **Model IDs change often**, so there's no default for these providers. Copy the exact ID from the provider's model page. Without one, the status shows "not set" and the free practice brain carries on.
- **Any other compatible endpoint** (a rented GPU server running vLLM, for example): set `VOXERA_LLM_PROVIDER=openai_compatible` and `VOXERA_LLM_BASE_URL` to its address ending in `/v1`.
- **Ollama only works where the API runs.** On your own computer (`http://localhost:11434/v1`) it's for development. The hosted API on Vercel can't reach your laptop.
- **Gemini** gets its tool definitions in the narrower format it accepts (nullable fields, no empty objects). This is converted automatically.
- **Reasoning models** (some Qwen versions) may "think out loud" in `<think>` tags. VOXERA hides that text from callers. Thinking uses up output tokens, so if replies come back empty or cut off, raise `VOXERA_LLM_MAX_OUTPUT_TOKENS` (default 400) or choose a non-thinking variant.
- **Token counts:** Groq and OpenRouter report exact usage. When a provider doesn't (Gemini's and Ollama's compatible endpoints may not), VOXERA estimates from the characters sent and received, about 3 characters per token, which errs high. The caps still hold.

**Free tiers: what to know before real callers use them**

- **Groq** and **Gemini** both have free tiers with per-minute and per-day limits. The limits apply to your whole account, shared by every business on VOXERA, and providers change them without notice.
- **Gemini's free tier** may use what's sent to improve Google's products, and people may review it. Some guides also say it can't be used to serve people in the UK or EU. Check Google's current terms before real customer conversations go through it; the paid tier doesn't use your data this way.
- Smaller open models are more likely to slip on a receptionist's job, such as misreading a time or skipping the availability check. Try any model in the Voice lab and Simulate before giving it to customers.

What's been verified (2026-11-02):
- **Automated tests** fake each provider at the HTTP level. They cover tool rounds, streaming, metering and estimates, errors, Gemini's schema format, hiding `<think>` text, the setup assistant, and the settings each provider needs.
- **Full site run:** in a real browser, the site ran against a local OpenAI-compatible stand-in, including a Simulate call that looked up the workspace's services.
- **Not verified here:** real Groq, Gemini, OpenRouter or Ollama accounts, which this environment can't reach. The first real test is setting a key and model, then trying the Voice lab.


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
