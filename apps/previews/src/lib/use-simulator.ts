"use client";

// Shared conversation-simulator hook. Each design renders it differently, but
// the behaviour (streaming replies, barge-in, tool events, optional browser
// speech) is identical so the designs can be compared fairly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APPOINTMENTS } from "./demo-data";
import { greeting, initialState, respond, SCENARIOS, type SimEvent, type SimState } from "./simulator";
import { usePreview } from "./store";

export interface SimMessage {
  id: number;
  event: SimEvent | { kind: "caller"; text: string };
  /** For agent messages: how much of the text has been "spoken" so far. */
  shown?: number;
  interrupted?: boolean;
}

export interface SimTiming {
  turn: number;
  agentMs: number;
  toolMs: number;
}

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

export function useSimulator() {
  const draft = usePreview((s) => s.draft);
  const knowledge = usePreview((s) => s.knowledge);
  const simBookings = usePreview((s) => s.simBookings);
  const addSimBookings = usePreview((s) => s.addSimBookings);

  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [state, setState] = useState<SimState>(initialState);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [failTools, setFailTools] = useState(false);
  const [tts, setTts] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [timings, setTimings] = useState<SimTiming[]>([]);
  const [level, setLevel] = useState(0);
  const idRef = useRef(1);
  const queue = useRef<SimEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const scenarioTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Feature detection runs after mount so server and client render the same markup.
  const [sttSupported, setSttSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSttSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    setTtsSupported("speechSynthesis" in window);
  }, []);

  const opts = useMemo(() => ({ persona: draft.persona, knowledge, appointments: [...APPOINTMENTS, ...simBookings], failTools }), [draft.persona, knowledge, simBookings, failTools]);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  const speak = useCallback((text: string) => {
    if (!tts || !ttsSupported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = draft.speakingRate;
    window.speechSynthesis.speak(u);
  }, [tts, ttsSupported, draft.speakingRate]);

  // Drain the event queue one item at a time, streaming agent text word by word.
  const pump = useCallback(() => {
    const next = queue.current.shift();
    if (!next) { setSpeaking(false); setThinking(false); setLevel(0); return; }
    if (next.kind === "agent") {
      setThinking(true);
      timer.current = setTimeout(() => {
        setThinking(false);
        setSpeaking(true);
        const id = idRef.current++;
        setMessages((m) => [...m, { id, event: next, shown: 0 }]);
        speak(next.text);
        const words = next.text.split(" ");
        let i = 0;
        const step = () => {
          i++;
          setLevel(0.35 + Math.random() * 0.65);
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, shown: words.slice(0, i).join(" ").length } : x)));
          if (i < words.length) timer.current = setTimeout(step, 55 + Math.random() * 40);
          else { setLevel(0); timer.current = setTimeout(pump, 120); }
        };
        step();
      }, Math.min(next.latencyMs, 900));
    } else {
      const delay = next.kind === "tool" ? Math.min(next.latencyMs, 1200) : 160;
      timer.current = setTimeout(() => {
        setMessages((m) => [...m, { id: idRef.current++, event: next }]);
        pump();
      }, delay);
    }
  }, [speak]);

  const enqueue = useCallback((events: SimEvent[]) => {
    queue.current.push(...events);
    const agentMs = events.filter((e) => e.kind === "agent").reduce((s, e) => s + (e as { latencyMs: number }).latencyMs, 0);
    const toolMs = events.filter((e) => e.kind === "tool").reduce((s, e) => s + (e as { latencyMs: number }).latencyMs, 0);
    setTimings((t) => [...t, { turn: t.length + 1, agentMs, toolMs }]);
    if (!timer.current) pump();
  }, [pump]);

  const start = useCallback(() => {
    clearTimer();
    scenarioTimers.current.forEach(clearTimeout);
    scenarioTimers.current = [];
    queue.current = [];
    if (ttsSupported) window.speechSynthesis.cancel();
    setMessages([]);
    setTimings([]);
    const s0 = initialState();
    setState(s0);
    stateRef.current = s0;
    enqueue(greeting(draft.persona));
  }, [enqueue, draft.persona, ttsSupported]);

  /** Caller speaks. If the agent is mid-sentence this is a barge-in: stop and truncate. */
  const send = useCallback((text: string) => {
    if (!text.trim()) return;
    let bargeIn = false;
    if (timer.current || queue.current.length) {
      bargeIn = true;
      clearTimer();
      queue.current = [];
      if (ttsSupported) window.speechSynthesis.cancel();
      setMessages((m) => m.map((x) => (x.event.kind === "agent" && (x.shown ?? 0) < x.event.text.length ? { ...x, interrupted: true } : x)));
      setSpeaking(false); setThinking(false);
    }
    setMessages((m) => [...m, { id: idRef.current++, event: { kind: "caller", text } }]);
    const { events, state: s1 } = respond(text, stateRef.current, opts);
    const evs: SimEvent[] = bargeIn ? [{ kind: "state", label: "Barge-in detected — agent stopped speaking" }, ...events] : events;
    setState(s1);
    stateRef.current = s1;
    if (s1.bookings.length) addSimBookings(s1.bookings);
    enqueue(evs);
  }, [opts, enqueue, addSimBookings, ttsSupported]);

  const runScenario = useCallback((id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) return;
    start();
    // Space caller lines so each reply can finish streaming before the next.
    scenarioTimers.current = sc.lines.map((line, i) => setTimeout(() => send(line), 2600 + i * 5200));
  }, [start, send]);

  /** Send as the caller, starting a call first (and letting the greeting finish) if none is active. */
  const submit = useCallback((text: string) => {
    if (!text.trim()) return;
    if (messages.length) return send(text);
    start();
    scenarioTimers.current.push(setTimeout(() => send(text), 2400));
  }, [messages.length, start, send]);

  const listen = useCallback(() => {
    if (!sttSupported) return;
    const W = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = "en-GB"; rec.interimResults = true; rec.continuous = false;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const t = r[0].transcript;
      if (r.isFinal) { setInterim(""); submit(t); } else setInterim(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [sttSupported, submit]);

  const stopListening = useCallback(() => { recRef.current?.stop(); setListening(false); }, []);

  useEffect(() => () => { clearTimer(); scenarioTimers.current.forEach(clearTimeout); if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  return {
    messages, state, speaking, thinking, level, timings,
    failTools, setFailTools, tts, setTts, ttsSupported,
    sttSupported, listening, interim, listen, stopListening,
    start, send, submit, runScenario, scenarios: SCENARIOS,
  };
}

export type Simulator = ReturnType<typeof useSimulator>;
