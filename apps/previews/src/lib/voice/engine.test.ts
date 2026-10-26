import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE, APPOINTMENTS } from "../demo-data";
import { DEFAULT_PERSONA } from "../simulator";
import { MessageTakerBrain, SimulatorBrain } from "./brains";
import { RECOVERY_LINE, VoiceSession } from "./engine";
import { faultyBrain, faultyTts, type Faults } from "./faults";
import { summarise } from "./summary";
import { ProviderError, type BrainAdapter, type BrainChunk, type Clock, type SessionEvent, type SttAdapter, type SttHandlers, type TtsAdapter, type TurnMetrics } from "./types";
import { Vad } from "./vad";

const clock: Clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

class FakeStt implements SttAdapter {
  name = "fake stt"; costPerMinGbp = 0; h: SttHandlers | null = null;
  start(h: SttHandlers) { this.h = h; }
  stop() { this.h = null; }
}

/** Starts audio after `startMs`, plays for 50 ms per word. */
class FakeTts implements TtsAdapter {
  name = "fake tts"; costPerMinGbp = 0; spoken: string[] = []; cancels = 0;
  private stop: (() => void) | null = null;
  constructor(private startMs = 100) {}
  speak(text: string, signal: AbortSignal, onStart: () => void) {
    return new Promise<void>((resolve) => {
      const t1 = setTimeout(() => { onStart(); this.spoken.push(text); }, this.startMs);
      const t2 = setTimeout(resolve, this.startMs + text.split(" ").length * 50);
      this.stop = () => { clearTimeout(t1); clearTimeout(t2); resolve(); };
      signal.addEventListener("abort", () => this.stop?.(), { once: true });
    });
  }
  cancel() { this.cancels++; this.stop?.(); }
}

/** Yields text after `delayMs`, optionally a tool call in the middle. */
const scripted = (delayMs: number, reply = "First sentence here. Second sentence follows.", tool = false): BrainAdapter => ({
  name: "scripted", costPerMinGbp: 0, reset() {},
  async *greet() { yield { type: "text", text: "Hello, Halden and Rye." } as BrainChunk; },
  async *respond() {
    await new Promise((r) => setTimeout(r, delayMs));
    const [a, b] = reply.split(/(?<=\.) /);
    yield { type: "text", text: a } as BrainChunk;
    if (tool) yield { type: "tool", name: "check_availability", args: { service: "cut" }, ok: true, result: "3 slots" } as BrainChunk;
    if (b) yield { type: "text", text: b } as BrainChunk;
  },
});

function setup(over: Partial<ConstructorParameters<typeof VoiceSession>[0]> = {}) {
  const stt = new FakeStt();
  const tts = new FakeTts();
  const s = new VoiceSession({ stt, brain: scripted(200), tts, clock, ...over });
  const events: SessionEvent[] = [];
  s.on((e) => events.push(e));
  const turns = () => events.filter((e): e is Extract<SessionEvent, { type: "turn" }> => e.type === "turn").map((e) => e.metrics);
  const notices = () => events.filter((e): e is Extract<SessionEvent, { type: "notice" }> => e.type === "notice").map((e) => e.text);
  return { s, stt, tts: (over.tts as FakeTts) ?? tts, events, turns, notices };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

describe("VoiceSession", () => {
  it("greets, then measures a voice turn from end of speech to first audio", async () => {
    const { s, stt, tts, turns } = setup();
    s.start();
    await run(1000);
    expect(tts.spoken[0]).toBe("Hello, Halden and Rye.");
    expect(turns()[0]).toMatchObject({ input: "greeting", e2eMs: 100 });

    s.vad({ type: "speech_start", atMs: Date.now() });
    expect(s.phase).toBe("user_speaking");
    await run(800);
    s.vad({ type: "speech_end", atMs: Date.now(), durationMs: 800 });
    await run(300);
    stt.h!.onPartial("I'd like");
    stt.h!.onFinal("I'd like a haircut");
    await run(2000);
    const t = turns()[1];
    expect(t).toMatchObject({ input: "voice", sttMs: 300, brainFirstMs: 200, ttsFirstMs: 100, e2eMs: 600, interrupted: false });
    // Streaming: both sentences spoken, as separate TTS requests.
    expect(tts.spoken.slice(1)).toEqual(["First sentence here.", "Second sentence follows."]);
    expect(s.phase).toBe("listening");
  });

  it("asks the voice to prepare each sentence as soon as it is queued", async () => {
    const tts = new FakeTts();
    const prepared: string[] = [];
    (tts as TtsAdapter).prepare = (t: string) => { prepared.push(t); };
    const { s } = setup({ tts });
    s.start(); await run(500);
    s.typed("hi");
    await run(250); // brain (200 ms) has replied; its first sentence has not started playing yet
    expect(prepared).toEqual(["Hello, Halden and Rye.", "First sentence here.", "Second sentence follows."]);
    expect(tts.spoken).not.toContain("Second sentence follows.");
  });

  it("emits tool calls during the turn and keeps speaking", async () => {
    const { s, events, tts } = setup({ brain: scripted(50, undefined, true) });
    s.start(); await run(500);
    s.typed("any slots Friday?");
    await run(2000);
    expect(events.some((e) => e.type === "tool" && e.name === "check_availability")).toBe(true);
    expect(tts.spoken).toHaveLength(3);
  });

  it("barge-in stops playback, aborts the turn and records recovery time", async () => {
    const { s, stt, tts, turns, events } = setup({ brain: scripted(10, "This is a long first sentence with many words in it. And more.") });
    s.start(); await run(500);
    s.typed("hi");
    await run(150); // first sentence is playing
    expect(s.phase).toBe("speaking");
    stt.h!.onPartial("sorry"); // one word: below threshold, treated as possible echo
    expect(s.phase).toBe("speaking");
    stt.h!.onPartial("sorry actually");
    expect(s.phase).toBe("user_speaking");
    expect(tts.cancels).toBeGreaterThan(0);
    const t = turns().at(-1)!;
    expect(t.interrupted).toBe(true);
    expect(t.bargeInRecoveryMs).toBe(0);
    expect(events.some((e) => e.type === "agent_done" && e.interrupted)).toBe(true);
    await run(3000);
    expect(tts.spoken).not.toContain("And more.");
  });

  it("VAD speech during playback is a barge-in too", async () => {
    const { s, turns } = setup();
    s.start(); await run(120);
    expect(s.phase).toBe("speaking");
    s.vad({ type: "speech_start", atMs: Date.now() - 120 });
    expect(turns()[0]).toMatchObject({ interrupted: true, bargeInRecoveryMs: 120 });
  });

  it("commits the last partial when the recogniser never sends a final", async () => {
    const { s, stt, events, turns } = setup();
    s.start(); await run(500);
    s.vad({ type: "speech_start", atMs: Date.now() });
    stt.h!.onPartial("what time do you close");
    s.vad({ type: "speech_end", atMs: Date.now(), durationMs: 800 });
    await run(1300);
    expect(events.some((e) => e.type === "caller" && e.text === "what time do you close")).toBe(true);
    await run(2000);
    expect(turns()[1].fallbacks).toContain("stt_final_timeout");
  });

  it("brain timeout → recovery line; repeated failures switch to the fallback brain", async () => {
    const faults: Faults = { brain: "hang", tts: false };
    const { s, tts, turns, notices } = setup({ brain: faultyBrain(scripted(10), () => faults), fallbackBrain: new MessageTakerBrain(), config: { brainFirstChunkTimeoutMs: 1000 } });
    s.start(); await run(500);
    s.typed("hello?");
    await run(4000);
    expect(tts.spoken.at(-1)).toBe(RECOVERY_LINE);
    expect(turns()[1].failures).toEqual(["brain"]);
    faults.brain = "error";
    s.typed("hello again");
    await run(4000);
    expect(notices().some((n) => n.includes("fallback brain"))).toBe(true);
    s.typed("book me in");
    await run(4000);
    expect(tts.spoken.join(" ")).toContain("can't check bookings");
  });

  it("TTS failure switches to the fallback voice without losing the reply", async () => {
    const faults: Faults = { brain: "ok", tts: true };
    const fb = new FakeTts(10);
    const { s, turns } = setup({ tts: faultyTts(new FakeTts(), () => faults), fallbackTts: fb });
    s.start(); await run(1000);
    expect(fb.spoken).toEqual(["Hello, Halden and Rye."]);
    expect(turns()[0].fallbacks).toEqual(["tts→fake tts"]);
  });

  it("fatal STT error falls back to typed input", async () => {
    const { s, stt, events } = setup();
    s.start(); await run(500);
    stt.h!.onError(new ProviderError("stt", "not-allowed", false));
    expect(events.some((e) => e.type === "providers" && e.typedOnly)).toBe(true);
  });

  it("silence: prompts once, then ends the call", async () => {
    const { s, tts, events } = setup({ config: { noInputMs: 5000 } });
    s.start(); await run(500);
    await run(5500);
    expect(tts.spoken.join(" ")).toContain("still there");
    expect(tts.spoken.join(" ")).not.toContain("end the call");
    await run(12000);
    expect(tts.spoken.join(" ")).toContain("end the call");
    expect(events.at(-1)).toMatchObject({ type: "ended", reason: "agent ended the call" });
  });

  it("drives the rule-based receptionist through a booking with tool calls", async () => {
    const brain = new SimulatorBrain(() => ({ persona: DEFAULT_PERSONA, knowledge: KNOWLEDGE, appointments: APPOINTMENTS }));
    const { s, events } = setup({ brain });
    s.start(); await run(3000);
    s.typed("Can I book a gloss on Friday afternoon?");
    await run(8000);
    expect(events.some((e) => e.type === "tool" && e.name === "check_availability")).toBe(true);
  });
});

describe("Vad", () => {
  const frames = (v: Vad, rms: number, fromMs: number, toMs: number) => {
    const out = [];
    for (let t = fromMs; t < toMs; t += 20) { const e = v.push(rms, t); if (e) out.push(e); }
    return out;
  };
  it("detects speech over background noise, with hangover", () => {
    const v = new Vad();
    expect(frames(v, 0.003, 0, 2000)).toEqual([]); // steady background noise
    const floor = v.floorDb;
    expect(floor).toBeGreaterThan(-55);
    const start = frames(v, 0.08, 2000, 3000);
    expect(start).toEqual([{ type: "speech_start", atMs: 2000 }]);
    expect(v.floorDb).toBeCloseTo(floor, 0); // speech barely moves the floor
    const end = frames(v, 0.003, 3000, 4000);
    expect(end).toEqual([{ type: "speech_end", atMs: 3000, durationMs: 1000 }]);
  });
  it("ignores short clicks", () => {
    const v = new Vad();
    frames(v, 0.003, 0, 1000);
    expect(frames(v, 0.2, 1000, 1060)).toEqual([]);
    expect(frames(v, 0.003, 1060, 2000)).toEqual([]);
  });
});

describe("summarise", () => {
  const t = (o: Partial<TurnMetrics>): TurnMetrics => ({ turn: 0, input: "voice", sttMs: null, brainFirstMs: null, brainTotalMs: null, ttsFirstMs: null, e2eMs: null, interrupted: false, bargeInRecoveryMs: null, failures: [], fallbacks: [], ...o });
  it("computes percentiles, failure rates and cost only when every price is known", () => {
    const turns = [t({ input: "greeting", e2eMs: 300 }), t({ e2eMs: 800, sttMs: 200 }), t({ e2eMs: 1200, failures: ["brain"] }), t({ interrupted: true, bargeInRecoveryMs: 40 })];
    const s = summarise(turns, [{ name: "a", costPerMinGbp: 0 }, { name: "b", costPerMinGbp: 0.01 }]);
    expect(s.timeToFirstAudioMs).toBe(300);
    expect(s.e2eMs).toEqual({ n: 2, p50: 800, p95: 1200 });
    expect(s.failureRate.brain).toBe(0.25);
    expect(s.bargeIns).toBe(1);
    expect(s.costPerMinGbp).toBe(0.01);
    expect(summarise(turns, [{ name: "x", costPerMinGbp: null }]).costPerMinGbp).toBeNull();
  });
});
