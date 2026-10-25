// Deterministic call analytics. Every aggregate is a pure function of the call
// records passed in, so each number on a dashboard can be traced back to the
// individual calls that produced it (see `evidence`).

import type { CallOutcome, CallRecord, Intent } from "./types";
import { addDays } from "./time";

export interface CallMetrics {
  total: number;
  answered: number;
  missed: number;
  voicemail: number;
  answerRate: number;
  avgDurationSec: number;
  totalMinutes: number;
  booked: number;
  rescheduled: number;
  cancelled: number;
  transferred: number;
  failed: number;
  messages: number;
  /** booked ÷ answered calls whose intent was booking or pricing (enquiries that could convert). */
  bookingConversion: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  totalCostGBP: number;
  costPerMinuteGBP: number;
  costPerBookingGBP: number;
  byOutcome: Record<CallOutcome, number>;
  byIntent: Record<Intent, number>;
}

const OUTCOMES: CallOutcome[] = ["booked", "rescheduled", "cancelled", "answered_question", "transferred", "message_taken", "abandoned", "failed", "no_answer"];
const INTENTS: Intent[] = ["booking", "reschedule", "cancellation", "pricing", "hours_location", "policy", "complaint", "other"];

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  // Nearest-rank method.
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1];
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function computeMetrics(calls: CallRecord[]): CallMetrics {
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<CallOutcome, number>;
  const byIntent = Object.fromEntries(INTENTS.map((i) => [i, 0])) as Record<Intent, number>;
  let answered = 0, missed = 0, voicemail = 0, durationSum = 0, cost = 0, convertible = 0;
  const latencies: number[] = [];
  for (const c of calls) {
    byOutcome[c.outcome]++;
    byIntent[c.intent]++;
    durationSum += c.durationSec;
    cost += c.costGBP;
    if (c.status === "answered") {
      answered++;
      latencies.push(c.latencyMsP50);
      if (c.intent === "booking" || c.intent === "pricing") convertible++;
    } else if (c.status === "missed") missed++;
    else voicemail++;
  }
  const connected = calls.filter((c) => c.durationSec > 0);
  const totalMinutes = durationSum / 60;
  return {
    total: calls.length,
    answered, missed, voicemail,
    answerRate: ratio(answered, calls.length),
    avgDurationSec: Math.round(ratio(durationSum, connected.length)),
    totalMinutes,
    booked: byOutcome.booked,
    rescheduled: byOutcome.rescheduled,
    cancelled: byOutcome.cancelled,
    transferred: byOutcome.transferred,
    failed: byOutcome.failed,
    messages: byOutcome.message_taken,
    bookingConversion: ratio(byOutcome.booked, convertible),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    totalCostGBP: cost,
    costPerMinuteGBP: ratio(cost, totalMinutes),
    costPerBookingGBP: ratio(cost, byOutcome.booked),
    byOutcome, byIntent,
  };
}

export function inRange(calls: CallRecord[], from: string, to: string) {
  return calls.filter((c) => c.date >= from && c.date <= to);
}

export interface DailyPoint {
  date: string;
  calls: number;
  answered: number;
  booked: number;
  transferred: number;
  failed: number;
  minutes: number;
  costGBP: number;
  latencyP50Ms: number;
}

export function dailySeries(calls: CallRecord[], from: string, to: string): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = calls.filter((c) => c.date === d);
    const m = computeMetrics(day);
    out.push({ date: d, calls: m.total, answered: m.answered, booked: m.booked, transferred: m.transferred, failed: m.failed, minutes: +m.totalMinutes.toFixed(1), costGBP: +m.totalCostGBP.toFixed(2), latencyP50Ms: m.latencyP50Ms });
  }
  return out;
}

export function hourlyHeatmap(calls: CallRecord[]): number[][] {
  // rows = weekday Mon..Sun, cols = hour 7..21
  const grid = Array.from({ length: 7 }, () => Array(15).fill(0));
  for (const c of calls) {
    const [y, m, d] = c.date.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const h = Math.floor(c.timeMin / 60) - 7;
    if (h >= 0 && h < 15) grid[wd][h]++;
  }
  return grid;
}

/** Calls that contributed to a given outcome — the evidence behind an aggregate. */
export function evidence(calls: CallRecord[], outcome: CallOutcome) {
  return calls.filter((c) => c.outcome === outcome);
}

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  booked: "Booked", rescheduled: "Rescheduled", cancelled: "Cancelled", answered_question: "Answered question",
  transferred: "Transferred", message_taken: "Message taken", abandoned: "Abandoned", failed: "Failed", no_answer: "Missed",
};

export const INTENT_LABEL: Record<Intent, string> = {
  booking: "New booking", reschedule: "Reschedule", cancellation: "Cancellation", pricing: "Pricing",
  hours_location: "Hours & location", policy: "Policies", complaint: "Complaint", other: "Other",
};
