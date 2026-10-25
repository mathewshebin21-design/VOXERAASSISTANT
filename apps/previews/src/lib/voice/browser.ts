// Browser adapters for the Voice lab. Free, no keys, no VOXERA servers involved.
// Caveat shown in the UI: in Chrome the Web Speech API sends microphone audio to a
// server-based recogniser (per MDN); other browsers may recognise on the device.
// Latency measured here describes these engines on this device, not the hosted
// providers in ADR-0004.

import { ProviderError, type SttAdapter, type SttHandlers, type TtsAdapter } from "./types";
import { Vad, type VadConfig, type VadEvent } from "./vad";

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const recCtor = (): (new () => Rec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => Rec>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const webSpeechSupported = () => !!recCtor();
export const speechSynthesisSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Continuous recognition with interim (partial) results; restarts itself when the browser stops it. */
export class WebSpeechStt implements SttAdapter {
  readonly name = "Browser speech recognition (Web Speech API)";
  readonly costPerMinGbp = 0;
  private rec: Rec | null = null;
  private active = false;
  private restarts = 0;
  constructor(private lang = "en-GB") {}

  start(h: SttHandlers) {
    const Ctor = recCtor();
    if (!Ctor) { h.onError(new ProviderError("stt", "speech recognition not supported in this browser", false)); return; }
    this.active = true;
    const rec = new Ctor();
    rec.lang = this.lang; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      this.restarts = 0;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) h.onFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      if (interim) h.onPartial(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture" || e.error === "language-not-supported";
      h.onError(new ProviderError("stt", e.error, !fatal));
      if (fatal) this.active = false;
    };
    // Browsers end recognition after silence or ~60 s; keep listening for the whole call.
    rec.onend = () => {
      if (!this.active) return;
      if (++this.restarts > 5) { this.active = false; h.onError(new ProviderError("stt", "recogniser keeps stopping", false)); return; }
      try { rec.start(); } catch { /* already started */ }
    };
    this.rec = rec;
    try { rec.start(); } catch (err) { h.onError(new ProviderError("stt", String(err), false)); }
  }

  stop() { this.active = false; try { this.rec?.abort(); } catch { /* ignore */ } this.rec = null; }
}

/** speechSynthesis with a start watchdog: some browsers (and headless ones) never start speaking. */
export class SpeechSynthesisTts implements TtsAdapter {
  readonly name = "Browser speech synthesis";
  readonly costPerMinGbp = 0;
  constructor(private opts: () => { rate: number; lang?: string }, private startTimeoutMs = 2500) {}

  speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void> {
    if (!speechSynthesisSupported()) return Promise.reject(new ProviderError("tts", "speech synthesis not supported", false));
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      const { rate, lang = "en-GB" } = this.opts();
      u.lang = lang; u.rate = rate;
      const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
      if (voice) u.voice = voice;
      let started = false;
      const done = (fn: () => void) => { clearTimeout(watchdog); signal.removeEventListener("abort", abort); fn(); };
      const watchdog = setTimeout(() => { if (!started) { synth.cancel(); done(() => reject(new ProviderError("tts", `no audio within ${this.startTimeoutMs} ms`))); } }, this.startTimeoutMs);
      const abort = () => { synth.cancel(); done(() => resolve()); };
      signal.addEventListener("abort", abort, { once: true });
      u.onstart = () => { started = true; onStart(); };
      u.onend = () => done(() => resolve());
      u.onerror = (e) => done(() => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new ProviderError("tts", e.error))));
      synth.speak(u);
    });
  }

  cancel() { if (speechSynthesisSupported()) window.speechSynthesis.cancel(); }
}

/**
 * Text-only "TTS": reveals the reply at a natural speaking pace with no audio.
 * Used when speech synthesis is unavailable or fails, so turn-taking and
 * barge-in still behave as they would on a call.
 */
export class TextPacedTts implements TtsAdapter {
  readonly name = "Text only (no audio)";
  readonly costPerMinGbp = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finish: (() => void) | null = null;
  constructor(private wordsPerMinute = 170) {}
  speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void> {
    return new Promise((resolve) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      const ms = Math.max(400, (words / this.wordsPerMinute) * 60000);
      onStart();
      this.finish = () => { if (this.timer) clearTimeout(this.timer); this.timer = null; this.finish = null; resolve(); };
      this.timer = setTimeout(() => this.finish?.(), ms);
      signal.addEventListener("abort", () => this.finish?.(), { once: true });
    });
  }
  cancel() { this.finish?.(); }
}

/** Microphone level meter feeding the VAD. Uses the browser's echo cancellation and noise suppression. */
export class MicVad {
  readonly vad: Vad;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(cfg: VadConfig, private onEvent: (e: VadEvent) => void, private onLevel: (rms: number, db: number, floorDb: number) => void) {
    this.vad = new Vad(cfg);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    // setInterval rather than requestAnimationFrame: keeps detecting speech in background tabs.
    this.timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const e = this.vad.push(rms, performance.now());
      this.onLevel(rms, this.vad.levelDb, this.vad.floorDb);
      if (e) this.onEvent(e);
    }, 20);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
