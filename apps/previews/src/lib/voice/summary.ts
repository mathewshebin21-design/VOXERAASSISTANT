// Aggregates measured turn metrics into the figures Phase 3 asks for.
import { percentile } from "../metrics";
import type { ProviderInfo, Stage, TurnMetrics } from "./types";

export interface LatencyStat { n: number; p50: number | null; p95: number | null }
export interface VoiceSummary {
  turns: number;
  sttMs: LatencyStat;
  brainFirstMs: LatencyStat;
  ttsFirstMs: LatencyStat;
  e2eMs: LatencyStat;
  /** Greeting only: call start → first agent audio. */
  timeToFirstAudioMs: number | null;
  bargeIns: number;
  bargeInRecoveryMs: LatencyStat;
  failureRate: Record<Stage, number>;
  fallbacks: number;
  /** Sum of configured per-minute prices; null if any provider has no price configured. */
  costPerMinGbp: number | null;
}

const stat = (xs: (number | null)[]): LatencyStat => {
  const v = xs.filter((x): x is number => x !== null);
  return { n: v.length, p50: v.length ? percentile(v, 50) : null, p95: v.length ? percentile(v, 95) : null };
};

export function summarise(turns: TurnMetrics[], providers: ProviderInfo[]): VoiceSummary {
  const n = turns.length;
  const rate = (s: Stage) => (n ? turns.filter((t) => t.failures.includes(s)).length / n : 0);
  const prices = providers.map((p) => p.costPerMinGbp);
  const greet = turns.find((t) => t.input === "greeting");
  return {
    turns: n,
    sttMs: stat(turns.map((t) => t.sttMs)),
    brainFirstMs: stat(turns.map((t) => t.brainFirstMs)),
    ttsFirstMs: stat(turns.map((t) => t.ttsFirstMs)),
    e2eMs: stat(turns.filter((t) => t.input === "voice" || t.input === "typed").map((t) => t.e2eMs)),
    timeToFirstAudioMs: greet?.e2eMs ?? null,
    bargeIns: turns.filter((t) => t.interrupted).length,
    bargeInRecoveryMs: stat(turns.map((t) => t.bargeInRecoveryMs)),
    failureRate: { stt: rate("stt"), brain: rate("brain"), tts: rate("tts") },
    fallbacks: turns.reduce((s, t) => s + t.fallbacks.length, 0),
    costPerMinGbp: prices.some((p) => p === null) ? null : (prices as number[]).reduce((a, b) => a + b, 0),
  };
}
