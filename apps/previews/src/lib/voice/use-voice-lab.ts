"use client";

// React wiring for the Voice lab: builds a VoiceSession from browser adapters,
// mirrors its events into state, and exposes controls for fault injection.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APPOINTMENTS } from "../demo-data";
import type { SimState } from "../simulator";
import { usePreview } from "../store";
import { MessageTakerBrain, SimulatorBrain } from "./brains";
import { MicVad, SpeechSynthesisTts, TextPacedTts, WebSpeechStt, speechSynthesisSupported, webSpeechSupported } from "./browser";
import { KokoroTts, kokoroSupported } from "./kokoro";
import { ApiBrain, ServerTts } from "./live";
import { VoiceSession } from "./engine";
import { faultyBrain, faultyTts, type Faults } from "./faults";
import { summarise } from "./summary";
import type { BrainAdapter, Phase, ProviderInfo, SessionEvent, TtsAdapter, TurnMetrics } from "./types";
import { DEFAULT_VAD, type VadConfig } from "./vad";

export type LabLine =
  | { id: number; kind: "caller"; text: string; input: "voice" | "typed" }
  | { id: number; kind: "agent"; text: string; done: boolean; interrupted: boolean }
  | { id: number; kind: "tool"; name: string; args: Record<string, unknown>; ok: boolean; result: string }
  | { id: number; kind: "guardrail"; rule: string; text: string }
  | { id: number; kind: "citation"; title: string; version: number }
  | { id: number; kind: "notice"; level: "info" | "warn" | "error"; text: string };

export interface LabOptions {
  mic: boolean;
  audio: boolean;
  /** Which voice speaks when audio is on and no live voice is selected. */
  voice?: { engine: "browser" } | { engine: "kokoro"; id: string };
  /** Use the live, metered providers through the API (signed-in workspaces only). */
  live?: { orgId: string; brain: string | null; voice: string | null };
}

export function useVoiceLab() {
  const draft = usePreview((s) => s.draft);
  const knowledge = usePreview((s) => s.knowledge);
  const simBookings = usePreview((s) => s.simBookings);
  const addSimBookings = usePreview((s) => s.addSimBookings);

  const [support, setSupport] = useState({ stt: false, tts: false, mic: false });
  useEffect(() => {
    setSupport({ stt: webSpeechSupported(), tts: speechSynthesisSupported(), mic: !!navigator.mediaDevices?.getUserMedia });
  }, []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<LabLine[]>([]);
  const [partial, setPartial] = useState("");
  const [turns, setTurns] = useState<TurnMetrics[]>([]);
  const [providers, setProviders] = useState({ stt: "—", brain: "—", tts: "—", typedOnly: false });
  const [ended, setEnded] = useState<string | null>(null);
  const [mic, setMic] = useState({ rms: 0, db: -100, floorDb: -65, speaking: false });
  const [simState, setSimState] = useState<SimState | null>(null);
  const [faults, setFaultsState] = useState<Faults>({ brain: "ok", tts: false });
  const [vadCfg, setVadCfg] = useState<VadConfig>(DEFAULT_VAD);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState("");
  const [priced, setPriced] = useState<ProviderInfo[]>([]);

  const faultsRef = useRef(faults);
  faultsRef.current = faults;
  const optsRef = useRef({ persona: draft.persona, knowledge, appointments: [...APPOINTMENTS, ...simBookings] });
  optsRef.current = { persona: draft.persona, knowledge, appointments: [...APPOINTMENTS, ...simBookings] };
  const rateRef = useRef(draft.speakingRate);
  rateRef.current = draft.speakingRate;
  const sessionRef = useRef<VoiceSession | null>(null);
  const micRef = useRef<MicVad | null>(null);
  const nextId = useRef(1);

  const onEvent = useCallback((e: SessionEvent) => {
    const id = nextId.current++;
    switch (e.type) {
      case "phase": setPhase(e.phase); break;
      case "partial": setPartial(e.text); break;
      case "caller": setLines((l) => [...l, { id, kind: "caller", text: e.text, input: e.input }]); break;
      case "agent": setLines((l) => [...l, { id: -e.id, kind: "agent", text: e.text, done: false, interrupted: false }]); break;
      case "agent_done": setLines((l) => l.map((x) => (x.kind === "agent" && x.id === -e.id ? { ...x, done: true, interrupted: e.interrupted } : x))); break;
      case "tool": setLines((l) => [...l, { id, kind: "tool", name: e.name, args: e.args, ok: e.ok, result: e.result }]); break;
      case "guardrail": setLines((l) => [...l, { id, kind: "guardrail", rule: e.rule, text: e.text }]); break;
      case "citation": setLines((l) => [...l, { id, kind: "citation", title: e.title, version: e.version }]); break;
      case "notice": setLines((l) => [...l, { id, kind: "notice", level: e.level, text: e.text }]); break;
      case "providers": setProviders({ stt: e.stt, brain: e.brain, tts: e.tts, typedOnly: e.typedOnly }); break;
      case "turn": setTurns((t) => [...t, e.metrics]); break;
      case "ended": setEnded(e.reason); setEndedAt(Date.now()); micRef.current?.stop(); micRef.current = null; break;
    }
  }, []);

  const start = useCallback(async (o: LabOptions) => {
    sessionRef.current?.end("restarted");
    micRef.current?.stop();
    setLines([]); setTurns([]); setEnded(null); setPartial(""); setSimState(null);
    const brain: BrainAdapter = o.live?.brain
      ? new ApiBrain(o.live.orgId, o.live.brain)
      : new SimulatorBrain(() => optsRef.current, (s) => { setSimState(s); if (s.bookings.length) addSimBookings(s.bookings); });
    const text = new TextPacedTts();
    const tts: TtsAdapter = o.live?.voice ? new ServerTts(o.live.orgId, o.live.voice)
      : !o.audio ? text
      : o.voice?.engine === "kokoro" && kokoroSupported() ? new KokoroTts(o.voice.id, () => rateRef.current)
      : speechSynthesisSupported() ? new SpeechSynthesisTts(() => ({ rate: rateRef.current })) : text;
    setPriced([brain, tts]);
    const s = new VoiceSession({
      stt: o.mic && webSpeechSupported() ? new WebSpeechStt() : null,
      brain: faultyBrain(brain, () => faultsRef.current),
      fallbackBrain: new MessageTakerBrain(),
      tts: faultyTts(tts, () => faultsRef.current),
      fallbackTts: text,
    });
    s.on(onEvent);
    sessionRef.current = s;
    if (o.mic && support.mic) {
      const m = new MicVad(vadCfg, (e) => sessionRef.current?.vad(e), (rms, db, floorDb) => setMic({ rms, db, floorDb, speaking: m.vad.speaking }));
      try { await m.start(); micRef.current = m; }
      catch (err) { onEvent({ type: "notice", level: "error", text: `Microphone unavailable (${err instanceof Error ? err.message : "denied"}). Barge-in by voice is off; type instead.` }); }
    }
    setStartedAt(Date.now());
    setEndedAt(null);
    setSessionKey(`lab-${crypto.randomUUID()}`);
    s.start();
  }, [onEvent, addSimBookings, support.mic, vadCfg]);

  const end = useCallback(() => { sessionRef.current?.end("you ended the call"); micRef.current?.stop(); micRef.current = null; }, []);
  const type = useCallback((t: string) => sessionRef.current?.typed(t), []);
  const setFaults = useCallback((f: Partial<Faults>) => setFaultsState((x) => ({ ...x, ...f })), []);
  const updateVad = useCallback((c: Partial<VadConfig>) => {
    setVadCfg((v) => ({ ...v, ...c }));
    if (micRef.current) micRef.current.vad.cfg = { ...micRef.current.vad.cfg, ...c };
  }, []);

  useEffect(() => () => { sessionRef.current?.end("left the page"); micRef.current?.stop(); }, []);

  const summary = useMemo(() => summarise(turns, priced), [turns, priced]);
  const active = phase !== "idle" && phase !== "ended";

  return { support, phase, active, lines, partial, turns, summary, providers, ended, mic, simState, faults, setFaults, vadCfg, updateVad, start, end, type, startedAt, endedAt, sessionKey };
}

export type VoiceLab = ReturnType<typeof useVoiceLab>;
