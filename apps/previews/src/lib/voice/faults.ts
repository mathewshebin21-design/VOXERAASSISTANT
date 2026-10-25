// Fault injection for demonstrating (and testing) graceful recovery.
import { ProviderError, type BrainAdapter, type BrainChunk, type TtsAdapter } from "./types";

export interface Faults { brain: "ok" | "error" | "hang"; tts: boolean }

export function faultyBrain(inner: BrainAdapter, faults: () => Faults): BrainAdapter {
  const wrap = (src: (s: AbortSignal) => AsyncIterable<BrainChunk>) => async function* (s: AbortSignal): AsyncIterable<BrainChunk> {
    const f = faults().brain;
    if (f === "error") throw new ProviderError("brain", "injected provider error (HTTP 503)");
    if (f === "hang") await new Promise<void>((resolve) => s.addEventListener("abort", () => resolve(), { once: true }));
    yield* src(s);
  };
  return {
    get name() { return inner.name; },
    costPerMinGbp: inner.costPerMinGbp,
    reset: () => inner.reset(),
    greet: (s) => inner.greet(s),
    respond: (text, s) => wrap((sig) => inner.respond(text, sig))(s),
  };
}

export function faultyTts(inner: TtsAdapter, faults: () => Faults): TtsAdapter {
  return {
    name: inner.name,
    costPerMinGbp: inner.costPerMinGbp,
    cancel: () => inner.cancel(),
    speak: (text, signal, onStart) => faults().tts ? Promise.reject(new ProviderError("tts", "injected synthesis failure")) : inner.speak(text, signal, onStart),
  };
}
