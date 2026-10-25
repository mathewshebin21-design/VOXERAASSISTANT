// Real-time voice session engine: turn-taking, streaming, barge-in, silence
// handling, provider failover and per-turn latency measurement.
//
// Pipeline per caller turn:
//   VAD speech_end ─► STT final ─► brain stream ─► sentence chunker ─► TTS queue
// The brain is consumed concurrently with playback, so the first sentence is
// spoken while later text and tool calls are still arriving.
//
// Every number in TurnMetrics is measured with the injected clock; nothing is
// estimated. With the browser engines they describe this browser, not the
// hosted providers planned for telephony.

import { ProviderError, realClock, type BrainAdapter, type BrainChunk, type Clock, type Phase, type SessionEvent, type Stage, type SttAdapter, type TtsAdapter, type TurnMetrics } from "./types";
import type { VadEvent } from "./vad";

export interface SessionConfig {
  /** After VAD speech_end, wait this long for a final transcript before committing the last partial. */
  sttFinalTimeoutMs: number;
  /** Give up on the brain if no output arrives within this time. */
  brainFirstChunkTimeoutMs: number;
  /** Ask "are you still there?" after this much silence; end the call after the second prompt. */
  noInputMs: number;
  /** Minimum words in a partial transcript before it counts as a barge-in (guards against echo). */
  bargeInMinWords: number;
  /** Consecutive brain failures before switching to the fallback brain. */
  brainFailoverAfter: number;
}

export const DEFAULT_SESSION: SessionConfig = { sttFinalTimeoutMs: 1200, brainFirstChunkTimeoutMs: 6000, noInputMs: 12000, bargeInMinWords: 2, brainFailoverAfter: 2 };

export interface SessionDeps {
  stt: SttAdapter | null;
  brain: BrainAdapter;
  tts: TtsAdapter;
  fallbackBrain?: BrainAdapter;
  fallbackTts?: TtsAdapter;
  clock?: Clock;
  config?: Partial<SessionConfig>;
}

export const RECOVERY_LINE = "Sorry, I'm having a problem on my side. I can take a message and have the team call you back — or you can try again in a moment.";
const STILL_THERE = "Are you still there? Take your time — I'm listening.";
const GOODBYE = "I haven't heard anything for a while, so I'll end the call now. Please ring back any time. Goodbye.";

const SENTENCE = /^([\s\S]*?[.!?…])(\s+|$)/;
const isAbort = (e: unknown) => e instanceof DOMException ? e.name === "AbortError" : (e as { name?: string })?.name === "AbortError";

class Timeout extends Error {}

export class VoiceSession {
  readonly cfg: SessionConfig;
  phase: Phase = "idle";
  private clock: Clock;
  private stt: SttAdapter | null;
  private brain: BrainAdapter;
  private tts: TtsAdapter;
  private listeners = new Set<(e: SessionEvent) => void>();
  private ids = 1;
  private turnNo = 0;
  private ctl: AbortController | null = null;
  private cur: TurnMetrics | null = null;
  private curAgentId: number | null = null;
  private lastSpeechEnd: number | null = null;
  private partial = "";
  private finalTimer: unknown = null;
  private silenceTimer: unknown = null;
  private prompts = 0;
  private brainFailures = 0;
  private typedOnly = false;
  private generation = 0;
  private pending: { failures: Stage[]; fallbacks: string[] } = { failures: [], fallbacks: [] };

  constructor(private deps: SessionDeps) {
    this.cfg = { ...DEFAULT_SESSION, ...deps.config };
    this.clock = deps.clock ?? realClock;
    this.stt = deps.stt;
    this.brain = deps.brain;
    this.tts = deps.tts;
    this.typedOnly = !deps.stt;
  }

  on(fn: (e: SessionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: SessionEvent) { this.listeners.forEach((l) => l(e)); }
  private setPhase(p: Phase) { if (this.phase !== p) { this.phase = p; this.emit({ type: "phase", phase: p }); } }
  private providers() { this.emit({ type: "providers", stt: this.stt?.name ?? "typed input", brain: this.brain.name, tts: this.tts.name, typedOnly: this.typedOnly }); }

  get busy() { return this.phase === "thinking" || this.phase === "speaking"; }

  start() {
    if (this.phase !== "idle" && this.phase !== "ended") return;
    this.turnNo = 0;
    this.prompts = 0;
    this.brainFailures = 0;
    this.brain.reset();
    this.providers();
    this.setPhase("listening");
    this.startStt();
    void this.runTurn("greeting", (s) => this.brain.greet(s), this.clock.now(), null);
  }

  end(reason = "caller hung up") {
    if (this.phase === "ended" || this.phase === "idle") return;
    this.interruptPlayback();
    this.clearTimers();
    this.stt?.stop();
    this.setPhase("ended");
    this.emit({ type: "ended", reason });
  }

  // ---------- inputs ----------

  /** Voice activity from the microphone. */
  vad(e: VadEvent) {
    if (this.phase === "ended" || this.phase === "idle") return;
    if (e.type === "speech_start") {
      this.clearSilence();
      if (this.busy) this.bargeIn(e.atMs, "voice activity");
      else this.setPhase("user_speaking");
    } else {
      this.lastSpeechEnd = e.atMs;
      // Some recognisers never send a final result; commit what we heard.
      this.clearFinal();
      this.finalTimer = this.clock.setTimeout(() => {
        this.finalTimer = null;
        if (this.partial.trim()) {
          this.note("stt_final_timeout");
          this.emit({ type: "notice", level: "warn", text: "No final transcript arrived — used the last partial result." });
          this.commit(this.partial, "voice");
        } else if (this.phase === "user_speaking") { this.setPhase("listening"); this.armSilence(); }
      }, this.cfg.sttFinalTimeoutMs);
    }
  }

  /** Text typed as the caller (also the fallback when speech recognition is unavailable). */
  typed(text: string) {
    if (!text.trim()) return;
    if (this.phase === "idle" || this.phase === "ended") return;
    const t = this.clock.now();
    if (this.busy) this.bargeIn(t, "typed input");
    this.lastSpeechEnd = t;
    this.commit(text, "typed");
  }

  private startStt() {
    if (!this.stt) return;
    const gen = this.generation;
    this.stt.start({
      onPartial: (text) => {
        if (gen !== this.generation || this.phase === "ended") return;
        this.partial = text;
        this.emit({ type: "partial", text });
        this.clearSilence();
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        if (this.busy && words >= this.cfg.bargeInMinWords) this.bargeIn(this.clock.now(), "speech recognised");
        else if (!this.busy && words) this.setPhase("user_speaking");
      },
      onFinal: (text) => {
        if (gen !== this.generation || this.phase === "ended") return;
        this.commit(text, "voice");
      },
      onError: (err) => {
        if (gen !== this.generation || this.phase === "ended") return;
        this.note("stt_error", "stt");
        if (!err.retryable) {
          this.typedOnly = true;
          this.stt?.stop();
          this.stt = null;
          this.emit({ type: "notice", level: "error", text: `Speech recognition stopped (${err.message}). Type as the caller instead.` });
          this.providers();
        } else this.emit({ type: "notice", level: "warn", text: `Speech recognition hiccup (${err.message}); still listening.` });
      },
    });
  }

  // ---------- turn handling ----------

  private bargeIn(at: number, cause: string) {
    if (!this.busy) return;
    const m = this.cur;
    this.interruptPlayback();
    if (m) {
      m.interrupted = true;
      m.bargeInRecoveryMs = Math.max(0, Math.round(this.clock.now() - at));
      this.emit({ type: "turn", metrics: { ...m } });
      this.cur = null;
    }
    this.emit({ type: "notice", level: "info", text: `Barge-in (${cause}) — agent stopped speaking.` });
    this.setPhase("user_speaking");
  }

  private interruptPlayback() {
    this.ctl?.abort();
    this.ctl = null;
    this.tts.cancel();
    if (this.curAgentId !== null) { this.emit({ type: "agent_done", id: this.curAgentId, interrupted: true }); this.curAgentId = null; }
  }

  private commit(raw: string, input: "voice" | "typed") {
    const text = raw.trim();
    this.partial = "";
    this.clearFinal();
    this.emit({ type: "partial", text: "" });
    if (!text) return;
    const now = this.clock.now();
    if (this.busy) this.bargeIn(now, "speech recognised");
    // Only trust a VAD end that belongs to this utterance.
    const vadEnd = input === "voice" && this.lastSpeechEnd !== null && now - this.lastSpeechEnd < 10000 ? this.lastSpeechEnd : null;
    const t0 = input === "typed" ? now : vadEnd ?? now;
    this.lastSpeechEnd = null;
    this.prompts = 0;
    this.clearSilence();
    this.emit({ type: "caller", id: this.ids++, text, input });
    void this.runTurn(input, (s) => this.brain.respond(text, s), t0, vadEnd !== null ? Math.round(now - vadEnd) : null);
  }

  private async runTurn(input: TurnMetrics["input"], source: (s: AbortSignal) => AsyncIterable<BrainChunk>, t0: number, sttMs: number | null) {
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    const m: TurnMetrics = { turn: this.turnNo++, input, sttMs, brainFirstMs: null, brainTotalMs: null, ttsFirstMs: null, e2eMs: null, interrupted: false, bargeInRecoveryMs: null, failures: [], fallbacks: [] };
    this.cur = m;
    this.flushPending(m);
    this.setPhase("thinking");
    const committed = this.clock.now();
    let buf = "";
    let endCall = false;
    let chain: Promise<void> = Promise.resolve();
    const say = (sentence: string) => { chain = chain.then(() => this.speakSentence(sentence, ctl, m, t0)); };

    try {
      await this.consume(source(ctl.signal), ctl, (c) => {
        if (m.brainFirstMs === null) m.brainFirstMs = Math.round(this.clock.now() - committed);
        if (c.type === "text") {
          buf += (buf && !/\s$/.test(buf) ? " " : "") + c.text;
          let match: RegExpMatchArray | null;
          while ((match = buf.match(SENTENCE))) { say(match[1].trim()); buf = buf.slice(match[0].length); }
        } else if (c.type === "end_call") endCall = true;
        else this.emit(c);
      });
      if (buf.trim()) say(buf.trim());
      m.brainTotalMs = Math.round(this.clock.now() - committed);
      this.brainFailures = 0;
    } catch (e) {
      if (ctl.signal.aborted) return;
      const why = e instanceof Timeout ? `no response within ${this.cfg.brainFirstChunkTimeoutMs} ms` : e instanceof Error ? e.message : "error";
      m.failures.push("brain");
      this.brainFailures++;
      this.emit({ type: "notice", level: "error", text: `${this.brain.name} failed (${why}). Spoke the recovery line instead.` });
      if (this.deps.fallbackBrain && this.brain !== this.deps.fallbackBrain && this.brainFailures >= this.cfg.brainFailoverAfter) {
        this.brain = this.deps.fallbackBrain;
        m.fallbacks.push(`brain→${this.brain.name}`);
        this.emit({ type: "notice", level: "warn", text: `Switched to fallback brain: ${this.brain.name}.` });
        this.providers();
      }
      buf = "";
      say(RECOVERY_LINE);
    }

    await chain;
    if (ctl.signal.aborted) return;
    this.ctl = null;
    if (this.cur === m) { this.emit({ type: "turn", metrics: { ...m } }); this.cur = null; }
    if (endCall) return this.end("agent ended the call");
    this.setPhase("listening");
    this.armSilence();
  }

  /** Iterates the brain stream, enforcing the first-chunk timeout and aborting on barge-in. */
  private async consume(it: AsyncIterable<BrainChunk>, ctl: AbortController, onChunk: (c: BrainChunk) => void) {
    const iter = it[Symbol.asyncIterator]();
    let first = true;
    for (;;) {
      if (ctl.signal.aborted) { void iter.return?.(); throw new DOMException("aborted", "AbortError"); }
      let timer: unknown = null;
      const next = iter.next();
      const res = first
        ? await Promise.race([next, new Promise<never>((_, rej) => { timer = this.clock.setTimeout(() => rej(new Timeout()), this.cfg.brainFirstChunkTimeoutMs); })]).finally(() => this.clock.clearTimeout(timer))
        : await next;
      first = false;
      if (res.done) return;
      if (ctl.signal.aborted) continue;
      onChunk(res.value);
    }
  }

  private async speakSentence(text: string, ctl: AbortController, m: TurnMetrics, t0: number) {
    if (ctl.signal.aborted) return;
    const id = this.ids++;
    const handedOver = this.clock.now();
    const onStart = () => {
      if (ctl.signal.aborted) return;
      if (m.ttsFirstMs === null) {
        const now = this.clock.now();
        m.ttsFirstMs = Math.round(now - handedOver);
        m.e2eMs = Math.round(now - t0);
      }
      this.setPhase("speaking");
    };
    this.curAgentId = id;
    this.emit({ type: "agent", id, text });
    try {
      await this.tts.speak(text, ctl.signal, onStart);
    } catch (e) {
      if (ctl.signal.aborted || isAbort(e)) return;
      m.failures.push("tts");
      const fb = this.deps.fallbackTts;
      if (fb && this.tts !== fb) {
        this.emit({ type: "notice", level: "warn", text: `${this.tts.name} failed (${e instanceof Error ? e.message : "error"}). Switched to ${fb.name}.` });
        this.tts = fb;
        m.fallbacks.push(`tts→${fb.name}`);
        this.providers();
        try { await this.tts.speak(text, ctl.signal, onStart); } catch { /* fallback is best effort */ }
      } else this.emit({ type: "notice", level: "error", text: "Speech output failed; reply shown as text only." });
    }
    if (!ctl.signal.aborted && this.curAgentId === id) { this.emit({ type: "agent_done", id, interrupted: false }); this.curAgentId = null; }
  }

  // ---------- silence detection ----------

  private armSilence() {
    this.clearSilence();
    if (this.phase !== "listening") return;
    this.silenceTimer = this.clock.setTimeout(() => {
      this.silenceTimer = null;
      if (this.phase !== "listening") return;
      this.prompts++;
      const line = this.prompts >= 2 ? GOODBYE : STILL_THERE;
      void this.runTurn("prompt", async function* () { yield { type: "text", text: line } as BrainChunk; if (line === GOODBYE) yield { type: "end_call" } as BrainChunk; }, this.clock.now(), null);
    }, this.cfg.noInputMs);
  }

  private clearSilence() { if (this.silenceTimer !== null) { this.clock.clearTimeout(this.silenceTimer); this.silenceTimer = null; } }
  private clearFinal() { if (this.finalTimer !== null) { this.clock.clearTimeout(this.finalTimer); this.finalTimer = null; } }
  private clearTimers() { this.clearSilence(); this.clearFinal(); this.generation++; }

  /** Records a failure or fallback against the current turn, or the next one if none is running. */
  private note(fallback: string, stage?: Stage) {
    if (stage) this.pending.failures.push(stage);
    this.pending.fallbacks.push(fallback);
    if (this.cur) this.flushPending(this.cur);
  }

  private flushPending(m: TurnMetrics) {
    m.failures.push(...this.pending.failures);
    m.fallbacks.push(...this.pending.fallbacks);
    this.pending = { failures: [], fallbacks: [] };
  }
}

export { ProviderError };
