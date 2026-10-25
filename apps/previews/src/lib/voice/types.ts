// Provider-agnostic contracts for the real-time voice pipeline.
//
// The session engine (engine.ts) only talks to these interfaces, so the browser
// speech engines used by the Voice lab, the fakes used in tests, and the hosted
// streaming providers planned for telephony (see ADR-0004) are interchangeable.

export type Stage = "stt" | "brain" | "tts";

export class ProviderError extends Error {
  constructor(public stage: Stage, message: string, public retryable = true) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderInfo {
  /** Shown in the UI and stored with session metrics. */
  readonly name: string;
  /** Price per audio minute in GBP if known, 0 for local/browser engines, null if not configured. */
  readonly costPerMinGbp: number | null;
}

export interface SttHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(err: ProviderError): void;
}

export interface SttAdapter extends ProviderInfo {
  start(h: SttHandlers): void;
  stop(): void;
}

export type BrainChunk =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; ok: boolean; result: string }
  | { type: "guardrail"; rule: string; text: string }
  | { type: "citation"; title: string; version: number }
  | { type: "end_call" };

export interface BrainAdapter extends ProviderInfo {
  reset(): void;
  greet(signal: AbortSignal): AsyncIterable<BrainChunk>;
  respond(text: string, signal: AbortSignal): AsyncIterable<BrainChunk>;
}

export interface TtsAdapter extends ProviderInfo {
  /** Resolves when playback finishes; calls onStart when the first audio plays. Rejects with ProviderError on failure. */
  speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void>;
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const realClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface TurnMetrics {
  turn: number;
  input: "greeting" | "voice" | "typed" | "prompt";
  /** End of caller speech (VAD) → final transcript. Null when no VAD end was observed. */
  sttMs: number | null;
  /** Transcript committed → first brain output. */
  brainFirstMs: number | null;
  brainTotalMs: number | null;
  /** First sentence handed to TTS → first audio. */
  ttsFirstMs: number | null;
  /** End of caller speech (or commit, for typed input) → first agent audio. */
  e2eMs: number | null;
  interrupted: boolean;
  /** Caller started speaking → agent audio stopped. */
  bargeInRecoveryMs: number | null;
  failures: Stage[];
  fallbacks: string[];
}

export type Phase = "idle" | "listening" | "user_speaking" | "thinking" | "speaking" | "ended";

export type SessionEvent =
  | { type: "phase"; phase: Phase }
  | { type: "partial"; text: string }
  | { type: "caller"; id: number; text: string; input: "voice" | "typed" }
  | { type: "agent"; id: number; text: string }
  | { type: "agent_done"; id: number; interrupted: boolean }
  | { type: "tool"; name: string; args: Record<string, unknown>; ok: boolean; result: string }
  | { type: "guardrail"; rule: string; text: string }
  | { type: "citation"; title: string; version: number }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | { type: "providers"; stt: string; brain: string; tts: string; typedOnly: boolean }
  | { type: "turn"; metrics: TurnMetrics }
  | { type: "ended"; reason: string };
