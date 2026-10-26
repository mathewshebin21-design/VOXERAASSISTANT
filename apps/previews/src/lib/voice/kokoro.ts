// Kokoro-82M (Apache-2.0) running on the device in a Web Worker. Free: no account,
// no per-character cost, no audio leaves the browser. First use downloads the
// model (~92 MB) from the official Hugging Face repository; later uses are cached.

import { playBlob, type Player } from "./audio";
import { ProviderError, type TtsAdapter } from "./types";

export interface KokoroVoice { id: string; name: string; accent: "British" | "American"; gender: "female" | "male"; grade: string }

// Grades are the model card's own "overall grade" for each voice.
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: "bf_emma", name: "Emma", accent: "British", gender: "female", grade: "B-" },
  { id: "bf_isabella", name: "Isabella", accent: "British", gender: "female", grade: "C" },
  { id: "bm_george", name: "George", accent: "British", gender: "male", grade: "C" },
  { id: "bm_fable", name: "Fable", accent: "British", gender: "male", grade: "C" },
  { id: "bm_lewis", name: "Lewis", accent: "British", gender: "male", grade: "D+" },
  { id: "bf_alice", name: "Alice", accent: "British", gender: "female", grade: "D" },
  { id: "bf_lily", name: "Lily", accent: "British", gender: "female", grade: "D" },
  { id: "bm_daniel", name: "Daniel", accent: "British", gender: "male", grade: "D" },
  { id: "af_heart", name: "Heart", accent: "American", gender: "female", grade: "A" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "female", grade: "A-" },
];

export interface KokoroProgress { state: "idle" | "loading" | "ready" | "error"; loaded: number; total: number; error?: string }
type Pending = { resolve: (r: { wav: ArrayBuffer; genMs: number }) => void; reject: (e: Error) => void };

/** One worker per page; the model loads once and is shared by previews and calls. */
class KokoroEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private ids = 1;
  private ready: Promise<void> | null = null;
  private files = new Map<string, { loaded: number; total: number }>();
  progress: KokoroProgress = { state: "idle", loaded: 0, total: 0 };
  private listeners = new Set<(p: KokoroProgress) => void>();

  onProgress(fn: (p: KokoroProgress) => void) { this.listeners.add(fn); fn(this.progress); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<KokoroProgress>) { this.progress = { ...this.progress, ...p }; this.listeners.forEach((l) => l(this.progress)); }

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker("/voice/kokoro-worker.js", { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "progress" && data.file && data.total) {
        this.files.set(data.file, { loaded: data.loaded ?? 0, total: data.total });
        const all = [...this.files.values()];
        this.set({ loaded: all.reduce((s, f) => s + f.loaded, 0), total: all.reduce((s, f) => s + f.total, 0) });
      } else if (data.type === "audio" || data.type === "error") {
        const p = this.pending.get(data.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (data.type === "audio") p.resolve({ wav: data.wav, genMs: data.genMs });
        else p.reject(new ProviderError("tts", data.message));
      }
    };
    w.onerror = (e) => {
      const err = new ProviderError("tts", e.message || "voice engine crashed");
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
      this.set({ state: "error", error: err.message });
      this.worker = null;
      this.ready = null;
    };
    this.worker = w;
    return w;
  }

  load(): Promise<void> {
    if (this.ready) return this.ready;
    const w = this.spawn();
    this.set({ state: "loading", error: undefined });
    this.ready = new Promise<void>((resolve, reject) => {
      const on = ({ data }: MessageEvent) => {
        if (data.type === "ready") { w.removeEventListener("message", on); this.set({ state: "ready" }); resolve(); }
        else if (data.type === "error" && data.id === undefined) {
          w.removeEventListener("message", on);
          this.set({ state: "error", error: data.message });
          this.ready = null;
          reject(new ProviderError("tts", `could not load the voice model (${data.message})`));
        }
      };
      w.addEventListener("message", on);
      w.postMessage({ type: "load" });
    });
    return this.ready;
  }

  synth(text: string, voice: string, speed: number): Promise<{ wav: ArrayBuffer; genMs: number }> {
    const w = this.spawn();
    const id = this.ids++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: "speak", id, text, voice, speed });
    });
  }
}

let engine: KokoroEngine | null = null;
export const kokoro = () => (engine ??= new KokoroEngine());
export const kokoroSupported = () => typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";

export class KokoroTts implements TtsAdapter {
  readonly costPerMinGbp = 0;
  readonly name: string;
  private player: Player = { stop: null, audio: null };
  // Sentences are synthesised as soon as they are queued, so the next one is ready when the current one ends.
  private cache = new Map<string, Promise<{ wav: ArrayBuffer; genMs: number }>>();

  constructor(private voice: string, private speed: () => number) {
    const v = KOKORO_VOICES.find((x) => x.id === voice);
    this.name = `Kokoro · ${v ? `${v.name} (${v.accent})` : voice} · on device`;
  }

  prepare(text: string) {
    if (!this.cache.has(text)) this.cache.set(text, kokoro().load().then(() => kokoro().synth(text, this.voice, this.speed())));
  }

  async speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void> {
    this.prepare(text);
    const job = this.cache.get(text)!;
    let wav: ArrayBuffer;
    try { ({ wav } = await job); } finally { this.cache.delete(text); }
    if (signal.aborted) return;
    await playBlob(new Blob([wav], { type: "audio/wav" }), signal, onStart, this.player);
  }

  cancel() { this.player.stop?.(); this.player.audio?.pause(); this.cache.clear(); }
}

/** Plays a short sample in the chosen voice (used by the voice picker). */
export async function previewKokoro(voice: string, text: string, speed = 1): Promise<number> {
  await kokoro().load();
  const { wav, genMs } = await kokoro().synth(text, voice, speed);
  const ctl = new AbortController();
  await playBlob(new Blob([wav], { type: "audio/wav" }), ctl.signal, () => undefined, { stop: null, audio: null });
  return genMs;
}
