// Cost assumptions used to put a *simulated* cost on demo calls.
// Figures are planning estimates taken from the Phase 0 research
// (docs/research/phase-0-competitive-research.md) and converted at an assumed
// 1 USD = 0.78 GBP. They are not quotes and must be re-checked against live
// provider pricing pages before any commercial use.

export const USD_TO_GBP = 0.78;

export interface CostLine {
  component: string;
  assumption: string;
  usdPerMin: number;
}

export const COST_ASSUMPTIONS: CostLine[] = [
  { component: "Telephony (UK local inbound)", assumption: "Twilio GB local inbound list rate", usdPerMin: 0.01 },
  { component: "Streaming STT", assumption: "Deepgram Flux/Nova-3 class PAYG", usdPerMin: 0.0077 },
  { component: "LLM", assumption: "Small/fast model, ~1.5k tokens per turn", usdPerMin: 0.02 },
  { component: "Streaming TTS", assumption: "Mid-tier streaming TTS", usdPerMin: 0.03 },
  { component: "Media/agent infra", assumption: "LiveKit Cloud agent session class", usdPerMin: 0.01 },
];

export const USD_PER_MIN = COST_ASSUMPTIONS.reduce((s, c) => s + c.usdPerMin, 0);
export const GBP_PER_MIN = +(USD_PER_MIN * USD_TO_GBP).toFixed(4);

export function simulatedCallCostGBP(durationSec: number): number {
  // Providers commonly bill per second or per started minute; we assume per second.
  return +((durationSec / 60) * GBP_PER_MIN).toFixed(4);
}

export interface Plan {
  id: string;
  name: string;
  monthlyGBP: number;
  includedMinutes: number;
  overagePerMinGBP: number;
  setupFeeGBP: number;
  features: string[];
}

// Draft commercial plans for discussion only (Phase 14 will produce the real proposal).
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyGBP: 79,
    includedMinutes: 300,
    overagePerMinGBP: 0.25,
    setupFeeGBP: 0,
    features: ["1 AI receptionist", "1 UK number", "Calendar booking", "Call transcripts"],
  },
  {
    id: "studio",
    name: "Studio",
    monthlyGBP: 189,
    includedMinutes: 900,
    overagePerMinGBP: 0.22,
    setupFeeGBP: 249,
    features: ["Everything in Starter", "Human transfer & SMS confirmations", "CRM sync", "Version history & rollback"],
  },
  {
    id: "multi",
    name: "Multi-site",
    monthlyGBP: 449,
    includedMinutes: 2500,
    overagePerMinGBP: 0.19,
    setupFeeGBP: 599,
    features: ["Up to 5 locations", "Per-site routing", "Analytics exports", "Priority support"],
  },
];
