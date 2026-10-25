import { describe, expect, it } from "vitest";
import { computeMetrics, percentile } from "./metrics";
import { CALLS } from "./demo-data";
import type { CallRecord } from "./types";

const base: CallRecord = {
  id: "x", source: "demo", date: "2026-10-01", timeMin: 600, durationSec: 120, callerName: "A B", callerNumberMasked: "",
  status: "answered", outcome: "booked", intent: "booking", sentiment: "positive", latencyMsP50: 700, costGBP: 0.12,
  summary: "", agentVersion: 5, tags: [],
};
const c = (o: Partial<CallRecord>): CallRecord => ({ ...base, ...o, id: Math.random().toString(36) });

describe("computeMetrics", () => {
  it("computes aggregates exactly from a hand-checked fixture", () => {
    const calls = [
      c({}),
      c({ outcome: "answered_question", intent: "pricing", durationSec: 60, costGBP: 0.06, latencyMsP50: 900 }),
      c({ outcome: "transferred", intent: "complaint", durationSec: 180, costGBP: 0.18, latencyMsP50: 800 }),
      c({ status: "missed", outcome: "no_answer", durationSec: 0, costGBP: 0, latencyMsP50: 0 }),
    ];
    const m = computeMetrics(calls);
    expect(m.total).toBe(4);
    expect(m.answered).toBe(3);
    expect(m.missed).toBe(1);
    expect(m.answerRate).toBeCloseTo(0.75);
    expect(m.avgDurationSec).toBe(120); // (120+60+180)/3 connected calls
    expect(m.totalMinutes).toBeCloseTo(6);
    expect(m.booked).toBe(1);
    expect(m.transferred).toBe(1);
    // convertible = answered booking+pricing calls = 2
    expect(m.bookingConversion).toBeCloseTo(0.5);
    expect(m.latencyP50Ms).toBe(800);
    expect(m.totalCostGBP).toBeCloseTo(0.36);
    expect(m.costPerMinuteGBP).toBeCloseTo(0.06);
    expect(m.costPerBookingGBP).toBeCloseTo(0.36);
  });

  it("returns zeros, not NaN, for an empty set", () => {
    const m = computeMetrics([]);
    expect(m.answerRate).toBe(0);
    expect(m.costPerBookingGBP).toBe(0);
    expect(m.latencyP50Ms).toBe(0);
  });

  it("outcome counts sum to total on the demo dataset", () => {
    const m = computeMetrics(CALLS);
    expect(Object.values(m.byOutcome).reduce((a, b) => a + b, 0)).toBe(m.total);
    expect(m.answered + m.missed + m.voicemail).toBe(m.total);
  });
});

describe("percentile", () => {
  it("uses nearest-rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});
