"use client";

import { clsx } from "clsx";
import { Download, Mic, PhoneOff, Play, Send, ShieldAlert, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveProviderPicker, SaveVoiceSession, VoiceHistory, type LiveChoice } from "@/components/flow/live-voice";
import { Chip, FBtn, FSwitch, Glass, GHead, Heading, Orb, finputAuto } from "@/components/flow/ui";
import { VoicePicker, type VoiceChoice } from "@/components/flow/voice-picker";
import type { LatencyStat } from "@/lib/voice/summary";
import { useVoiceLab } from "@/lib/voice/use-voice-lab";

const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} ms`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

const PHASE_LABEL: Record<string, string> = { idle: "Not connected", listening: "Listening", user_speaking: "Caller speaking", thinking: "Thinking", speaking: "Agent speaking", ended: "Call ended" };

function Stat({ label, s, hint }: { label: string; s: LatencyStat; hint: string }) {
  return (
    <div className="rounded-xl border border-flw-line/70 bg-flw-surface/50 p-3" title={hint}>
      <div className="text-[11px] text-flw-mute">{label}</div>
      <div className="mt-0.5 font-mono text-lg">{ms(s.p50)}</div>
      <div className="font-mono text-[10px] text-flw-mute">p95 {ms(s.p95)} · n={s.n}</div>
    </div>
  );
}

export default function VoiceLab() {
  const lab = useVoiceLab();
  const [useMic, setUseMic] = useState(false);
  const [audio, setAudio] = useState(true);
  const [text, setText] = useState("");
  const [live, setLive] = useState<LiveChoice>(undefined);
  const [voice, setVoice] = useState<VoiceChoice>({ engine: "browser" });
  const onLive = useCallback((c: LiveChoice) => setLive(c), []);
  useEffect(() => { if (lab.ended) window.dispatchEvent(new Event("voxera:voice-ended")); }, [lab.ended]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [lab.lines, lab.partial]);
  useEffect(() => { if (lab.support.stt && lab.support.mic) setUseMic(true); }, [lab.support.stt, lab.support.mic]);

  const level = lab.phase === "speaking" ? 0.55 : lab.phase === "user_speaking" ? Math.min(1, 0.3 + lab.mic.rms * 10) : lab.phase === "thinking" ? 0.25 : lab.active ? Math.min(0.4, lab.mic.rms * 10) : 0.06;
  const s = lab.summary;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), providers: lab.providers, summary: s, turns: lab.turns, note: "Measured in the browser with browser speech engines and a rule-based brain." }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `voxera-voice-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // Meter scale: -80 dB … 0 dB.
  const pos = (db: number) => `${Math.min(100, Math.max(0, ((db + 80) / 80) * 100))}%`;

  return (
    <>
      <Heading kicker="Voice lab · real-time engine" title="Talk to your receptionist">
        <Chip tone={live ? "pink" : "amber"}>{live ? "live providers · metered" : "browser engines · rule-based brain"}</Chip>
      </Heading>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[440px_1fr]">
        <Glass glow="violet" className="flex h-[calc(100vh-170px)] min-h-[600px] flex-col">
          <div className="flex items-center gap-4 border-b border-flw-line/70 p-4">
            <Orb level={level} size={72} />
            <div className="min-w-0 flex-1">
              <div className="font-display font-medium" data-testid="voice-phase">{PHASE_LABEL[lab.phase]}</div>
              <div className="truncate font-mono text-[11px] text-flw-mute">{lab.ended ? lab.ended : lab.active ? (lab.providers.typedOnly ? "typed input · speak or type to interrupt" : "speak any time — interrupting works") : "voice pipeline idle"}</div>
            </div>
            {lab.active
              ? <FBtn onClick={lab.end} aria-label="End call" className="border-flw-pink/60 text-flw-pink"><PhoneOff size={15} /></FBtn>
              : <FBtn variant="glow" onClick={() => void lab.start({ mic: useMic, audio, live, voice })}><Play size={14} /> Start call</FBtn>}
          </div>
          {!lab.active && (
            <div className="max-h-[55%] shrink-0 space-y-2 overflow-y-auto border-b border-flw-line/70 p-4 text-sm">
              <label className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Mic size={14} /> Use microphone {!lab.support.stt && <span className="text-xs text-flw-mute">(not supported here — use Chrome or Edge)</span>}</span><FSwitch label="Use microphone" on={useMic && lab.support.stt} onChange={setUseMic} /></label>
              <label className="flex items-center justify-between gap-3"><span>Speak replies aloud</span><FSwitch label="Speak replies aloud" on={audio} onChange={setAudio} /></label>
              {audio && !live?.voice && <VoicePicker value={voice} onChange={setVoice} />}
              <LiveProviderPicker onChange={onLive} disabled={lab.active} />
              <p className="text-xs leading-relaxed text-flw-mute">{live ? "Your words are sent to VOXERA’s API and on to the live providers you switched on; transcripts are not stored, only usage counts." : "Nothing is sent to VOXERA and nothing is recorded."} With the microphone on, your browser’s own speech recogniser is used — in Chrome that sends your audio to Google’s servers to transcribe; other browsers may process it on the device or remotely. Use headphones so the agent’s voice isn’t mistaken for yours.</p>
            </div>
          )}
          <div className="flex-1 space-y-2.5 overflow-y-auto p-4" aria-live="polite">
            {!lab.lines.length && !lab.active && <p className="text-sm text-flw-mute">Start a call, then talk (or type) as the caller. Try booking a cut, asking about parking, or interrupting the agent mid-sentence.</p>}
            {lab.lines.map((l) =>
              l.kind === "caller" ? <div key={l.id} className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-flw-line/70 px-3.5 py-2 text-sm">{l.text}<span className="ml-2 font-mono text-[9px] text-flw-mute">{l.input === "voice" ? "🎙" : "⌨"}</span></div>
              : l.kind === "agent" ? <div key={l.id} className={clsx("max-w-[88%] rounded-2xl rounded-bl-md border px-3.5 py-2 text-sm", l.interrupted ? "border-flw-amber/50 bg-flw-amber/5 text-flw-mute line-through decoration-flw-amber/40" : "border-flw-violet/40 bg-flw-violet/10", !l.done && !l.interrupted && "flw-glow")}>{l.text}{l.interrupted && <span className="ml-1 font-mono text-[10px] text-flw-amber no-underline">✂ interrupted</span>}</div>
              : l.kind === "tool" ? <div key={l.id} className={clsx("flex items-center gap-2 font-mono text-[11px]", l.ok ? "text-flw-cyan" : "text-flw-pink")}><Wrench size={12} />{l.name} {l.ok ? "✓" : "✗"} <span className="truncate text-flw-mute">{l.result}</span></div>
              : l.kind === "guardrail" ? <div key={l.id} className="flex items-start gap-2 font-mono text-[11px] text-flw-amber"><ShieldAlert size={12} className="mt-0.5" />{l.rule}</div>
              : l.kind === "citation" ? <div key={l.id} className="font-mono text-[10px] text-flw-mute">§ {l.title} v{l.version}</div>
              : <div key={l.id} role={l.level === "error" ? "alert" : undefined} className={clsx("text-center font-mono text-[10px]", l.level === "error" ? "text-flw-pink" : l.level === "warn" ? "text-flw-amber" : "text-flw-mute")}>{l.text}</div>,
            )}
            {lab.partial && <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md border border-dashed border-flw-line px-3.5 py-2 text-sm italic text-flw-mute" data-testid="partial">{lab.partial}…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); lab.type(text); setText(""); }} className="flex items-center gap-2 border-t border-flw-line/70 p-3">
            <input aria-label="Type as the caller" value={text} onChange={(e) => setText(e.target.value)} disabled={!lab.active} placeholder={lab.active ? "Type as the caller (interrupts too)…" : "Start a call first"} className="min-w-0 flex-1 rounded-xl border border-flw-line bg-flw-bg/70 px-3 py-2 text-sm outline-none focus:border-flw-cyan disabled:opacity-50" />
            <FBtn type="submit" variant="glow" aria-label="Send" disabled={!lab.active || !text.trim()}><Send size={14} /></FBtn>
          </form>
        </Glass>

        <div className="min-w-0 space-y-4">
          <Glass>
            <GHead title="Latency — measured this session" right={<div className="flex items-center gap-2"><SaveVoiceSession lab={lab} /><FBtn onClick={exportJson} disabled={!lab.turns.length} aria-label="Export metrics"><Download size={13} /></FBtn></div>} />
            <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
              <div className="rounded-xl border border-flw-cyan/40 bg-flw-cyan/5 p-3"><div className="text-[11px] text-flw-mute">Time to first audio</div><div className="mt-0.5 font-mono text-lg" data-testid="ttfa">{ms(s.timeToFirstAudioMs)}</div><div className="font-mono text-[10px] text-flw-mute">call start → greeting</div></div>
              <Stat label="End-to-end" s={s.e2eMs} hint="End of caller speech (or send, for typed) → first agent audio" />
              <Stat label="Speech recognition" s={s.sttMs} hint="End of speech (voice activity) → final transcript" />
              <Stat label="Brain first output" s={s.brainFirstMs} hint="Transcript → first response chunk" />
              <Stat label="Synthesis start" s={s.ttsFirstMs} hint="Sentence handed to TTS → audio starts" />
              <Stat label="Barge-in recovery" s={s.bargeInRecoveryMs} hint="Caller starts speaking → agent audio stops" />
              <div className="rounded-xl border border-flw-line/70 bg-flw-surface/50 p-3"><div className="text-[11px] text-flw-mute">Failures (stt / brain / tts)</div><div className="mt-0.5 font-mono text-lg">{pct(s.failureRate.stt)} / {pct(s.failureRate.brain)} / {pct(s.failureRate.tts)}</div><div className="font-mono text-[10px] text-flw-mute">{s.turns} turns · {s.bargeIns} barge-ins · {s.fallbacks} fallbacks</div></div>
              <div className="rounded-xl border border-flw-line/70 bg-flw-surface/50 p-3"><div className="text-[11px] text-flw-mute">Cost per call minute</div><div className="mt-0.5 font-mono text-lg">{s.costPerMinGbp === null ? "metered" : `£${s.costPerMinGbp.toFixed(3)}`}</div><div className="font-mono text-[10px] text-flw-mute">{s.costPerMinGbp === null ? "live usage counted on the Usage page" : "browser engines are free"}</div></div>
            </div>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full font-mono text-[11px]" data-testid="turn-table">
                <thead className="text-flw-mute"><tr>{["#", "input", "stt", "brain", "tts", "e2e", "barge-in", "notes"].map((h) => <th key={h} className="py-1 text-left font-normal">{h}</th>)}</tr></thead>
                <tbody>{lab.turns.slice(-10).map((t, i) => (
                  <tr key={i} className="border-t border-flw-line/50">
                    <td className="py-1">{t.turn}</td><td>{t.input}</td><td>{ms(t.sttMs)}</td><td>{ms(t.brainFirstMs)}</td><td>{ms(t.ttsFirstMs)}</td><td>{ms(t.e2eMs)}</td>
                    <td className={t.interrupted ? "text-flw-amber" : ""}>{t.interrupted ? ms(t.bargeInRecoveryMs) : "—"}</td>
                    <td className="text-flw-pink">{[...t.failures.map((f) => `${f} failed`), ...t.fallbacks].join(", ")}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-[11px] leading-relaxed text-flw-mute">Measured live with <code>performance.now()</code>. These figures describe your browser’s speech engines and the local rule-based brain — they are not benchmarks of the hosted providers planned for phone calls, which will be measured the same way once they’re connected.</p>
            </div>
          </Glass>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Glass>
              <GHead title="Pipeline & failure drills" />
              <dl className="space-y-1.5 p-4 text-xs">
                {([["Speech-to-text", lab.providers.stt], ["Brain", lab.providers.brain], ["Text-to-speech", lab.providers.tts]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-flw-mute">{k}</dt><dd className="truncate text-right" data-testid={`provider-${k}`}>{v}</dd></div>)}
              </dl>
              <div className="space-y-2 border-t border-flw-line/70 p-4 text-sm">
                <label className="flex items-center justify-between gap-3">Brain provider
                  <select aria-label="Brain fault" value={lab.faults.brain} onChange={(e) => lab.setFaults({ brain: e.target.value as "ok" | "error" | "hang" })} className={finputAuto}>
                    <option value="ok">healthy</option><option value="error">returns errors</option><option value="hang">stops responding</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3">Voice output fails<FSwitch label="Fail text-to-speech" on={lab.faults.tts} onChange={(b) => lab.setFaults({ tts: b })} /></label>
                <p className="text-[11px] text-flw-mute">Errors → recovery line, then the message-taking fallback after two in a row. A hung brain times out after 6 s. Failed speech switches to text-only output. None of these drills ever claim a booking.</p>
              </div>
            </Glass>
            <Glass>
              <GHead title="Voice activity & silence" right={<Chip tone={lab.mic.speaking ? "lime" : "mute"}>{lab.mic.speaking ? "speech" : "quiet"}</Chip>} />
              <div className="p-4">
                <div className="relative h-3 overflow-hidden rounded-full bg-flw-line/60" aria-label="Microphone level">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-flw-cyan to-flw-violet transition-[width] duration-75" style={{ width: pos(lab.mic.db) }} />
                  <div className="absolute inset-y-0 w-0.5 bg-flw-mute" style={{ left: pos(lab.mic.floorDb) }} title="noise floor" />
                  <div className="absolute inset-y-0 w-0.5 bg-flw-amber" style={{ left: pos(lab.mic.floorDb + lab.vadCfg.thresholdDb) }} title="speech threshold" />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[10px] text-flw-mute"><span>level {lab.mic.db.toFixed(0)} dB</span><span>noise floor {lab.mic.floorDb.toFixed(0)} dB</span></div>
                <label className="mt-3 block text-xs">Speech threshold above noise: {lab.vadCfg.thresholdDb} dB
                  <input type="range" min={6} max={24} value={lab.vadCfg.thresholdDb} onChange={(e) => lab.updateVad({ thresholdDb: Number(e.target.value) })} className="w-full accent-[rgb(var(--flw-cyan))]" />
                </label>
                <label className="block text-xs">End-of-speech silence: {lab.vadCfg.hangoverMs} ms
                  <input type="range" min={300} max={1500} step={50} value={lab.vadCfg.hangoverMs} onChange={(e) => lab.updateVad({ hangoverMs: Number(e.target.value) })} className="w-full accent-[rgb(var(--flw-cyan))]" />
                </label>
                <p className="mt-1 text-[11px] text-flw-mute">The noise floor adapts to the room, so steady background noise isn’t treated as speech. After 12 s of silence the agent checks you’re still there; after another 12 s it ends the call.</p>
              </div>
            </Glass>
          </div>
          <VoiceHistory />
          {lab.simState && (
            <Glass>
              <GHead title="Conversation state" />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 font-mono text-[11px] sm:grid-cols-4">
                {[["stage", lab.simState.stage], ["service", lab.simState.serviceId ?? "—"], ["customer", lab.simState.customerName ?? "—"], ["bookings", lab.simState.bookings.length]].map(([k, v]) => <div key={String(k)} className="flex justify-between gap-2"><dt className="text-flw-mute">{k}</dt><dd>{String(v)}</dd></div>)}
              </dl>
            </Glass>
          )}
        </div>
      </div>
    </>
  );
}
