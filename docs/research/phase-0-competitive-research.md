# VOXERA AI — Phase 0: Competitive & Technical Research

_Research date: 25 October 2026. Status: input to the design-approval gate. Nothing here has been validated by building on, or paying for, any provider._

---

## 0. Method and limits

**How this was done.** Desk research using web search (October 2026). Each result was read for the specific claim, then classified:

| Label | Meaning |
|---|---|
| **V — Vendor-stated** | Claimed on the vendor's own site, docs or changelog. A real product claim, but not independently tested. |
| **3P — Third-party** | Reported by a blog, comparison site or analyst. Many are written by **competitors** (e.g. Ringly, Ringg, Macha, 11x) and should be read with that bias in mind. |
| **A — Assumption** | Our inference or planning estimate. Must be validated in Phase 3/4. |

**Limits you should know about.**

1. **Primary pricing pages could not be fetched.** This environment's network policy blocked direct access (HTTP 403 at the proxy) to retellai.com, vapi.ai, livekit.io, twilio.com and elevenlabs.io. Prices below come from search-engine extracts of those pages, or from third-party write-ups. **Every price must be re-checked on the live pricing page before any commercial decision.**
2. **No hands-on testing.** No latency, quality or reliability numbers in this document were measured by us. Where a latency figure appears, it's someone else's claim and is labelled.
3. Pricing in this market changes often. Bland moved from a flat rate to tiered plans in December 2025; Synthflow appears to have removed self-serve pricing in mid-2026; Vapi retired "Workflows" in favour of "Squads" on 18 August 2026. Expect further change.
4. UK legal points are summarised from secondary commentary, not legal advice. Before launch, confirm them against ICO, Ofcom and legislation.gov.uk primary texts and get a qualified review.

---

## 1. Landscape at a glance

| Platform | Type | What it's best at (as claimed) | Pricing signal (Oct 2026) | Source quality |
|---|---|---|---|---|
| **Retell AI** | Managed voice-agent platform | Phone agents with knowledge base, warm transfer (with context summary), native Cal.com booking, post-call analysis | PAYG ~$0.07–0.31/min by component; 3P "realistic" ~$0.11–0.15/min all-in; $2/mo per number; 20 free concurrent calls, then $8/call/mo | V (features), 3P (all-in cost) |
| **Vapi** | Developer-first voice API / orchestration | Highly configurable; bring-your-own STT/LLM/TTS; "Squads" multi-assistant handoffs; transfer + dynamic transfer via server webhook | $0.05/min platform fee + pass-through providers; 10 concurrent lines included, +$10/line/mo; HIPAA add-on reported at $2,000/mo | V (docs), 3P (pricing) |
| **Bland AI** | Managed, enterprise-leaning | Outbound/inbound at volume, self-hosted model claims | Since 5 Dec 2025: Start ~$0.14/min, Build $0.12/min + $299/mo, Scale $0.11/min + $499/mo; telephony billed separately | 3P (several agree) |
| **Synthflow** | No-code agent builder | Non-technical setup, white-label for agencies | Self-serve PAYG reportedly removed mid-2026; Enterprise from ~$30k/yr (3P) | 3P, conflicting |
| **PolyAI** | Enterprise managed service | Large-brand customer service (hospitality, banking, utilities); 45 languages claimed; customers include Marriott, Caesars, Gordon Ramsay Restaurants | Custom enterprise contracts; $86m Series D (Dec 2025) | V / 3P |
| **ElevenLabs Agents** | Voice-first agent platform | Very strong TTS voices, conversational agent hosting | Reported $0.08/min platform rate across plans + LLM + telephony; burst over concurrency ~$0.16/min | 3P |
| **Twilio Voice** | Telephony (CPaaS) | Numbers, SIP, call control, media streams | UK local inbound $0.0100/min + ~$3.50/mo per local number; UK outbound to local ~$0.0158/min | V (Twilio GB pricing page, via search extract) |
| **Telnyx** | Telephony + voice AI | Owns network; lower carrier rates; "Voice AI Agents" product | Voice agent $0.05/min (orchestration + STT + TTS; LLM/telephony extra); SIP inbound from ~$0.0032–0.0035/min (US); UK rates not found | V (pricing page via search) |
| **LiveKit Agents** | Open-source framework + optional cloud | WebRTC media server, SIP bridge, Python/Node agent SDK, open-weights turn-detector model | Framework free (Apache-2.0). Cloud: Build $0 (1,000 agent min), Ship $50, Scale $500; agent sessions ~$0.01/min | V (docs), 3P (cloud price) |
| **Pipecat** (Daily) | Open-source framework + optional cloud | Vendor-neutral Python pipeline; Smart Turn open-source turn model; Pipecat Flows for structured conversations | Framework free (BSD-2). Pipecat Cloud GA (Jan 2026) | V / 3P |
| **OpenAI Realtime API** | Speech-to-speech model API | Single model handles audio in/out; supports WebRTC, WebSocket **and SIP** | gpt-realtime: $32 / 1M audio input tokens, $0.40 cached, $64 / 1M audio output; 3P estimate ~$0.06–0.11/min with good caching | V (OpenAI model page) |

---

## 2. Capability findings (the 20 research questions)

For each area: **what the market does**, **evidence**, and **implication for VOXERA**.

### 2.1 Real-time speech recognition (STT)
- Streaming STT with partial transcripts is standard. **Deepgram Flux** combines transcription with end-of-turn detection (events `EndOfTurn`, `EagerEndOfTurn`), removing the need for a separate VAD layer (V). Reported PAYG ~$0.0065–0.0077/min; Nova-3 streaming ~$0.0048–0.0077/min, some rates promotional (3P).
- **Implication:** pick an STT provider behind an adapter; Flux is the first candidate to benchmark because it does turn detection natively.

### 2.2 Streaming speech synthesis (TTS)
- **Cartesia Sonic** claims sub-90 ms model-level time-to-first-audio. Independent measurements cited in 3P articles put real-world medians at ~166–190 ms with network jitter. ElevenLabs is widely regarded as the quality leader but costs more (Retell lists ElevenLabs voices at $0.040/min vs $0.015/min for its own) (V/3P).
- **Implication:** TTS is likely the largest per-minute cost line after telephony and LLM. Offer a "standard" and "premium" voice tier.

### 2.3 Voice activity detection & 2.4 End-of-turn detection
- Industry has moved beyond silence-timeout VAD. **LiveKit's turn detector** is an open-weights model combining VAD with semantic/acoustic signals; recent docs describe audio-native v1 and CPU-only v1-mini variants (V). **Pipecat Smart Turn v3** is an open-source audio-based turn model (weights, training code, data) (3P partner page). Deepgram Flux does it inside STT (V).
- **Implication:** end-of-turn quality is the single biggest driver of "does this feel human". We should A/B LiveKit's detector vs Flux vs Smart Turn on recorded UK-accented test audio in Phase 3. **Do not claim** turn-taking quality until measured.

### 2.5 Interruptions / barge-in
- All major platforms support barge-in (agent stops speaking when caller talks) (V). Key engineering detail: truncate the LLM context to what was **actually spoken**, not what was generated.
- **Implication:** the previews already model this (interrupted messages are marked and truncated). Phase 3 must implement spoken-text-aware truncation.

### 2.6 Streaming LLM responses
- Standard approach: stream tokens → sentence chunker → streaming TTS. Speech-to-speech models (OpenAI Realtime) skip text but make tool-use auditing and grounding harder to inspect.
- **Implication:** start with a **cascaded pipeline** (STT → LLM → TTS) for inspectability and grounding control; keep a speech-to-speech adapter as an experiment.

### 2.7 End-to-end latency
- Common target quoted by practitioners: ~800 ms voice-to-voice (Daily/Pipecat talk, 3P). Vendors claim "sub-second" (V). No independent cross-vendor benchmark was found that we'd trust without reproducing.
- **Implication:** set an internal target of p50 < 1,000 ms and p95 < 1,600 ms on UK telephony **as a goal, not a claim**, and measure it per turn (time-to-first-audio, STT final, LLM first token, TTS first byte).

### 2.8 Phone number provisioning & 2.9 Inbound/outbound
- Twilio: UK local inbound $0.0100/min, number ~$3.50/mo (V, via search extract — note an older cached page showed no monthly fee; confirm). Telnyx positions itself as cheaper for UK SIP but we found no published UK figure (3P). UK numbers need regulatory address/identity bundles; allow lead time (A, common carrier requirement — verify).
- **Implication:** start **inbound only**. Outbound AI calling triggers PECR marketing rules (§4) and is out of scope for the MVP.

### 2.10 Appointment scheduling
- Retell has a native Cal.com integration with custom fields (V). Most platforms do bookings via custom function/webhook tools (V).
- UK salon software: **Phorest** offers partner-gated REST API access (appointments, clients, staff, services); Fresha and Treatwell public APIs were not found (3P).
- **Implication:** our booking engine must own the rules (durations, buffers, staff skills, patch-test lead times) and sync to calendars. A Phorest partnership would be a meaningful UK salon differentiator but depends on partner approval.

### 2.11 Call routing & transfers / 2.12 Human escalation
- Warm transfer with context summary is now table stakes (Retell "Warm Transfer 2.0" with human detection, V). Vapi supports transfer to number/SIP and server-decided dynamic transfers (V).
- **Implication:** need warm transfer + message fallback when no one answers (modelled in the simulator's failure mode).

### 2.13 Knowledge-base retrieval
- Retell "Knowledge Base 2.0" claims up to 50% answer-accuracy improvement in its own tests (V — unverified).
- **Implication:** competitors have KBs. Our angle is **governance**: verified-only answers, source citations, conflict detection, prompt-injection quarantine, and versioning — visible to the owner.

### 2.14 CRM integration
- Common via webhooks/Zapier-style connectors; native HubSpot/Salesforce varies by platform (3P).
- **Implication:** start with signed outbound webhooks + HubSpot; REVORA/ORCHESTRA integration is internal-suite value.

### 2.15 Conversation memory
- Typically per-call context plus caller lookup by number (find existing bookings). Long-term "memory" raises GDPR minimisation questions.
- **Implication:** caller recognition limited to booking lookup by verified phone number; no free-form long-term memory in the MVP.

### 2.16 Multilingual
- PolyAI claims 45 languages (V); most platforms are multilingual via provider choice. UK MVP: English (UK) first; Welsh is a credible later differentiator for Welsh businesses but needs provider support verified (A).

### 2.17 Call analytics
- Post-call analysis with structured fields (boolean/enum/number) is standard (Retell, V).
- **Implication:** our metrics must be deterministic from call records, with drill-down to the calls behind each number (implemented in previews).

### 2.18 Pricing & infrastructure
- See §3. Managed all-in costs cluster around **$0.08–0.15/min** for typical configs (3P), with wide spread depending on LLM/TTS choice.

### 2.19 Privacy & recording consent — see §4.

### 2.20 Enterprise reliability
- Vendor uptime claims (e.g. "99.9%+") are marketing (V). HIPAA/BAA is usually an expensive add-on (Vapi ~$2,000/mo, Retell ~$1,000/mo reported, 3P). Concurrency limits matter for peak-hour salons.
- **Implication:** design for provider failover (secondary STT/TTS), graceful degradation (take a message), and idempotent call/booking processing.

---

## 3. Managed platform vs self-hosted pipeline

| Factor | Build on managed platform (Retell/Vapi) | Own pipeline (LiveKit Agents or Pipecat + chosen providers) |
|---|---|---|
| Time to first real call | Days | 2–4 weeks |
| Per-minute cost | Platform fee ($0.05–0.08/min) **plus** providers | Providers only + hosting (~$0.01/min LiveKit Cloud sessions, or self-host) |
| Control of turn-taking, prompts, tool validation | Partial (platform abstractions) | Full |
| Data residency / UK-EU hosting | Depends on vendor | Our choice |
| Vendor lock-in | High | Low (adapters) |
| Ops burden | Low | Medium–high (real-time workers, media, scaling) |
| Portfolio value ("advanced AI engineering") | Low–medium | High |

**Recommendation (A — to be validated in Phase 3):**
- **Own the orchestration with LiveKit Agents** (Python), because it bundles WebRTC media, a SIP bridge for telephony, and an open-weights turn detector, and can run on LiveKit Cloud first (low ops) then self-host. **Pipecat** is the fallback; run a short spike on both before committing.
- **Cascaded pipeline** first: Deepgram (Flux) STT → provider-agnostic LLM (small/fast model with tool calling) → streaming TTS (Cartesia for cost/latency; ElevenLabs as premium).
- **Telephony via Twilio** (best documentation, UK numbers) behind an adapter; evaluate **Telnyx** for cost once volumes justify it.
- Keep a **Retell/Vapi adapter in reserve** as a fallback if our own pipeline cannot hit latency targets in time.

**Indicative cost per minute (A, from §1 list prices):** telephony $0.010 + STT $0.0077 + LLM ~$0.02 + TTS ~$0.03 + agent infra ~$0.01 ≈ **$0.078/min ≈ £0.061/min** at 0.78 GBP/USD. This is the assumption used for "simulated cost" in the previews. It excludes support, storage and failed-call overhead.

---

## 4. UK regulatory notes (to confirm with primary sources and a qualified adviser)

| Topic | What we found | Design consequence |
|---|---|---|
| **Call recording (UK GDPR)** | Recordings and transcripts of identifiable callers are personal data. Commentary says legitimate interests is the usual lawful basis for routine recording, with transparency before capture; consent is rarely the practical basis (3P — **not yet confirmed against ICO text**). | Configurable recording notice played before capture; retention policy (default 90 days in previews); transcript deletion; subject-access export. |
| **AI disclosure** | Vendor guidance recommends disclosing AI at the outset. A claimed Ofcom "5-second disclosure" rule could **not** be verified. EU AI Act transparency duties may matter for EU callers but don't directly apply in the UK (3P, conflicting). | Disclosure is **mandatory and non-removable** in VOXERA's greeting validation (implemented in all three wizards). |
| **PECR — marketing calls** | Automated marketing calls require prior consent. Whether an AI voice agent counts as "automated" is unsettled (3P). The **Data (Use and Access) Act 2025** raises PECR maximum fines to £17.5m or 4% of global turnover; provisions commence in stages (3P, law firms). | MVP is **inbound only**. No outbound marketing calls without separate legal review. |
| **Automated decision-making** | DUAA relaxes UK GDPR Art. 22 except where special-category data is involved; safeguards (contest, human review) remain (3P). | Agent doesn't make significant decisions about people; humans can review every call. |
| **Health/clinical** | Software that triages symptoms to recommend action can be a medical device (MHRA); classification depends on intended purpose (3P law-firm commentary). CQC questions not researched. | **Avoid clinics with clinical triage in the MVP.** The agent gives no medical advice; safety script points to 999 / NHS 111 (implemented). |
| **Financial services** | FCA requires some regulated firms to record calls (3P). | Out of scope for MVP. |

---

## 5. Recommended initial market

**Recommendation: independent UK hair & beauty salons (2–15 staff), then non-clinical aesthetics/wellness.**

Why:
- **Clear, measurable pain.** Vendor-reported figures suggest a large share of salon calls go unanswered (various sources: 27–47% for UK SMEs; Zenoti reports ~30–35% for salons/spas). These are **vendor statistics, not independent research**, but they're consistent in direction.
- **Booking-centred conversations** with bounded scope (services, prices, hours, patch tests) — well suited to grounded answers and a deterministic booking engine.
- **Lower regulatory risk** than clinics (no clinical triage) or financial services.
- **Narrow enough for great templates** (services, patch-test rules, deposits, cancellation policies).

Risks:
- Competitive: UK salon platforms already add AI receptionists (e.g. SalonIQ advertises a 24/7 AI receptionist; Zenoti sells one). VOXERA must integrate with, not replace, their booking systems — Phorest partner API access is the first integration to pursue (needs approval).
- Price sensitivity: small salons expect ~£50–£200/month pricing.

**Not recommended for MVP:** dental/medical clinics (clinical triage, MHRA/CQC exposure), outbound sales (PECR), regulated financial advice.

---

## 6. Realistic differentiators (and what is *not* a differentiator)

**Not differentiators** (competitors already do these): voice quality, knowledge bases, warm transfer, calendar booking, post-call analytics, multi-language.

**Credible differentiators for VOXERA:**
1. **Vertical depth for UK salons:** domain rules (patch tests, deposits, stylist skills, buffers) in the booking engine; UK-English voice defaults; GBP pricing; salon-software integration.
2. **Grounding you can see:** verified-only answers, source citations per answer, conflict detection between sources, prompt-injection quarantine for uploaded documents, and "I don't know" behaviour — all visible to the owner.
3. **Operator trust tooling:** simulator with scripted edge cases (including failures) before publishing; versioned agents with one-click rollback; call-level evidence behind every metric.
4. **Compliance-by-default:** undeletable AI disclosure, configurable recording notice and retention, export and deletion.
5. **Transparent pricing:** clear allowance + overage, with provider costs visible.

We have **no evidence** that VOXERA is better than any established competitor today. These are hypotheses to test with real salons.

---

## 7. MVP definition (proposed)

**In:** inbound calls on one UK number per workspace · AI disclosure + recording notice · answer from verified knowledge · book/reschedule/cancel with explicit confirmation · warm transfer + message fallback · Google Calendar sync · SMS confirmation · call log, transcripts, deterministic analytics · agent versioning + simulator · UK GDPR controls (retention, deletion, export) · multi-tenant auth and roles.

**Out (later phases):** outbound calling, salon-software integrations beyond one pilot, Salesforce, multilingual, speech-to-speech models, white-label.

**MVP success criteria (to measure, not assume):** task completion on the labelled evaluation set; zero un-confirmed bookings; zero fabricated prices/policies on the grounding test set; p50 voice-to-voice latency on real UK calls; cost per answered minute.

---

## Sources

Pricing & platforms
- [Retell pricing analysis — 11x.ai](https://www.11x.ai/guides/retell-ai-pricing) · [eesel.ai](https://eesel.ai/blog/retell-ai-pricing) · [Macha](https://www.getmacha.com/blog/retell-ai-pricing-explained) · [Ringly cost breakdown](https://www.ringly.io/blog/ai-voice-agent-pricing) · [Retell's own pricing article](https://www.retellai.com/blog/ai-voice-agent-pricing-full-cost-breakdown-platform-comparison-roi-analysis)
- [Retell changelog — KB 2.0, Warm Transfer 2.0](https://www.retellai.com/changelog/major-platform-upgrades-knowledge-base-warm-transfer-voice-analytics) · [Retell post-call analysis](https://www.retellai.com/features/post-call-analysis) · [Retell warm transfer / Cal.com fields](https://retellai.com/changelog/new-dashboard-warm-transfer-cal-com-fields-and-partner-programs)
- [Vapi pricing — zeeg](https://zeeg.me/en/blog/post/vapi-ai-pricing) · [Macha](https://www.getmacha.com/blog/vapi-ai-pricing-explained) · [Fora Soft](https://www.forasoft.com/blog/article/vapi-vs-retell-vs-custom) · [CloudTalk](https://cloudtalk.io/blog/vapi-ai-pricing)
- [Vapi Workflows → Squads](https://docs.vapi.ai/workflows/legacy-migration) · [Vapi transfer-call tool](https://docs.vapi.ai/tools/transfer-call/llms.txt) · [Vapi dynamic transfers](https://docs.vapi.ai/calls/call-dynamic-transfers.mdx)
- [Bland pricing — Macha](https://www.getmacha.com/blog/bland-ai-pricing-explained) · [11x](https://www.11x.ai/guides/bland-ai-pricing) · [Ringly](https://www.ringly.io/nl/blog/bland-ai-pricing) · [Fora Soft](https://www.forasoft.com/blog/article/bland-ai-alternatives)
- [Synthflow pricing — Macha](https://www.getmacha.com/blog/synthflow-pricing-explained) · [usagepricing](https://usagepricing.com/blueprint/synthflow) · [CloudTalk](https://www.cloudtalk.io/blog/synthflow-pricing/) · [zeeg](https://zeeg.me/en/blog/post/synthflow-ai-pricing)
- [PolyAI — CMSWire](https://www.cmswire.com/the-wire/gordon-ramsay-applies-his-no-nonsense-standards-to-customer-service-in-polyai-campaign/) · [Gartner profile](https://www.gartner.com/reviews/market/enterprise-conversational-ai-platforms/vendor/polyai/product/polyai-voice-assistant) · [Rework](https://resources.rework.com/libraries/ai-terms/what-is-polyai) · [Dealroom](https://app.dealroom.co/companies/poly_ai)
- [ElevenLabs Agents pricing — Macha](https://www.getmacha.com/blog/elevenlabs-agents-pricing-explained) · [CloudZero](https://www.cloudzero.com/blog/elevenlabs-pricing/) · [HappyRobot](https://www.happyrobot.ai/hub/elevenlabs-pricing)
- [Twilio Voice GB pricing](https://www.twilio.com/en-us/voice/pricing/gb) · [Telnyx Voice AI pricing](https://telnyx.com/pricing/voice-ai-agents) · [Telnyx developer pricing](https://developers.telnyx.com/pricing)
- [LiveKit turn detection docs](https://docs.livekit.io/agents/build/turn-detection) · [LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector) · [LiveKit pricing (markdown)](https://livekit.com/pricing.md) · [TRTC LiveKit pricing 2026](https://trtc.io/blog/details/livekit-pricing-2026)
- [Pipecat on PyPI](https://pypi.org/project/pipecat-ai) · [Cekura — Smart Turn](https://www.cekura.ai/partners/pipecat) · [Pipecat Cloud talk](https://ai.engineer/talks/pipecat-cloud-enterprise-voice-agents-built-on-open-source) · [Daily blog summary Jan 2026](https://www.plushcap.com/companies/daily/blog/summaries/2026/01)
- [OpenAI gpt-realtime model page](https://developers.openai.com/api/docs/models/gpt-realtime) · [gpt-realtime-mini](https://developers.openai.com/api/docs/models/gpt-realtime-mini) · [Fora Soft — Realtime pricing](https://www.forasoft.com/blog/article/openai-realtime-api-pricing)
- [Deepgram pricing — HappyRobot](https://www.happyrobot.ai/hub/deepgram-pricing) · [diyai](https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/) · [Deepgram latency docs](https://developers.deepgram.com/docs/measuring-streaming-latency.mdx)
- [Cartesia Sonic — invideo](https://invideo.io/blog/cartesia-sonic-ai-voice/) · [TTS pricing comparison](https://invideo.io/blog/ai-voice-model-pricing/) · [FutureAGI](https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/)

Market
- [SalonIQ — AI receptionist guide](https://www.saloniq.com/advice/the-future-of-front-desk-ai-receptionist-for-salons-uk-2026-guide/) · [Softomate — UK salons](https://www.softomatesolutions.com/blog/ai-receptionist-beauty-salons-uk/) · [Zenoti ROI](https://www.zenoti.com/en-uk/thecheckin/ai-receptionist-roi) · [Zenoti call conversion](https://www.zenoti.com/blog/how-to-measure-your-salon-call-conversion-rate)
- [Phorest API (third-party guide)](https://supergood.ai/docs/phorest-api) · [API Evangelist — Phorest](https://providers.apievangelist.com/providers/phorest/)

Regulation
- [ICO — PECR live marketing calls guidance (news)](https://www.freevacy.com/news/ico/ico-publishes-pecr-guidelines-for-live-direct-marketing-calls/2910) · [IAPP](https://iapp.org/news/a/ico-issues-guidelines-for-live-direct-marketing-calls) · [Softomate — GDPR/PECR for AI voice](https://www.softomatesolutions.com/blog/gdpr-pecr-call-recording-ai-voice-agents-uk-2026/) · [SMB London — generative voice AI](https://www.smb.london/insights/hello-is-it-generative-voice-ai-youre-looking-for/) · [Ainora — AI receptionist UK GDPR](https://ainora.lt/blog/ai-receptionist-uk-gdpr-ico-compliance-guide)
- [UK call recording — Connection Technologies](https://connection-technologies.co.uk/blog/call-recording-business-uk-2026) · [Mediahawk](https://support.mediahawk.co.uk/support/solutions/articles/17000093253-call-recording-uk-gdpr)
- [DUAA 2025 — Addleshaw Goddard](https://www.addleshawgoddard.com/en/insights/insights-briefings/2025/data-protection/data-use-and-access-act-2025-top-7-changes/) · [Osborne Clarke](https://www.osborneclarke.com/insights/data-use-and-access-act-becomes-law-first-ever-changes-uk-gdpr) · [Clyde & Co](https://www.clydeco.com/en/insights/2025/07/the-data-use-and-access-act-2025)
- [MHRA software & AI as a medical device — Burges Salmon](https://www.burges-salmon.com/articles/102icot/mhra-publishes-guidance-for-software-and-ai-as-a-medical-device) · [BioWorld](https://bioworld.com/articles/708042-uk-mhra-expects-to-up-classify-some-ai-device-software)
