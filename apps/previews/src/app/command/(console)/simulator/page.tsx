"use client";

import { clsx } from "clsx";
import { Mic, MicOff, Play, RotateCcw, Send, ShieldAlert, Volume2, VolumeX, Wrench, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Btn, PageHead, Panel, Tag, Toggle } from "@/components/command/ui";
import { Waveform } from "@/components/command/waveform";
import { useSimulator } from "@/lib/use-simulator";

export default function Simulator() {
  const sim = useSimulator();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sim.messages]);
  const started = sim.messages.length > 0;
  const tools = sim.messages.filter((m) => m.event.kind === "tool" || m.event.kind === "guardrail" || m.event.kind === "citation");

  return (
    <>
      <PageHead kicker="Build · test" title="Conversation simulator">
        <Tag tone="warn">Text simulation · rule-based stand-in for the LLM</Tag>
      </PageHead>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <Panel dense title={<span className="flex items-center gap-2">session <span className={clsx("h-1.5 w-1.5 rounded-full", started ? "bg-cmd-ok cmd-blink" : "bg-cmd-mute")} /> {sim.state.stage}</span>}
          action={<div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] text-cmd-mute sm:inline">fail tools</span>
            <Toggle label="Simulate provider failures" on={sim.failTools} onChange={sim.setFailTools} />
            <button className="rounded p-1 text-cmd-mute hover:text-cmd-text disabled:opacity-30" onClick={() => sim.setTts(!sim.tts)} disabled={!sim.ttsSupported} aria-label={sim.tts ? "Mute browser voice" : "Speak replies with browser voice"} title="Browser speech synthesis">{sim.tts ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
          </div>}>
          <div className="border-b border-cmd-line px-4 py-3">
            <Waveform level={sim.speaking ? sim.level : sim.listening ? 0.45 : sim.thinking ? 0.12 : 0} height={52} />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-cmd-mute">
              <span>{sim.speaking ? "AGENT SPEAKING — type to barge in" : sim.thinking ? "THINKING…" : sim.listening ? "LISTENING (browser STT)" : "IDLE"}</span>
              <span>turn {sim.timings.length}</span>
            </div>
          </div>
          <div className="h-[440px] space-y-3 overflow-y-auto px-4 py-4 scroll-thin" aria-live="polite">
            {!started && (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="text-sm text-cmd-mute">Start a simulated call, then type as the caller.</p>
                  <Btn variant="primary" className="mt-3" onClick={sim.start}><Play size={14} /> Start call</Btn>
                </div>
              </div>
            )}
            {sim.messages.map((m) => {
              const e = m.event;
              if (e.kind === "caller") return <div key={m.id} className="ml-auto max-w-[80%] rounded-lg rounded-br-sm bg-cmd-raised px-3 py-2 text-sm"><div className="font-mono text-[10px] uppercase text-cmd-mute">caller</div>{e.text}</div>;
              if (e.kind === "agent") return (
                <div key={m.id} className="max-w-[85%] rounded-lg rounded-bl-sm border border-cmd-violet/30 bg-cmd-violet/10 px-3 py-2 text-sm">
                  <div className="font-mono text-[10px] uppercase text-cmd-violet">agent {m.interrupted && <span className="text-cmd-warn">· interrupted</span>}</div>
                  {e.text.slice(0, m.shown ?? e.text.length)}{(m.shown ?? 0) < e.text.length && !m.interrupted && <span className="cmd-blink">▍</span>}
                </div>
              );
              if (e.kind === "tool") return <div key={m.id} className={clsx("flex items-start gap-2 font-mono text-[11px]", e.ok ? "text-cmd-cyan" : "text-cmd-bad")}><Wrench size={12} className="mt-0.5 shrink-0" />{e.name}({Object.keys(e.args).join(", ")}) → {e.result}</div>;
              if (e.kind === "guardrail") return <div key={m.id} className="flex items-start gap-2 font-mono text-[11px] text-cmd-warn"><ShieldAlert size={12} className="mt-0.5 shrink-0" />guardrail:{e.rule} — {e.text}</div>;
              if (e.kind === "citation") return <div key={m.id} className="font-mono text-[10px] text-cmd-mute">↳ source: {e.title} (v{e.version})</div>;
              return <div key={m.id} className="text-center font-mono text-[10px] uppercase tracking-wider text-cmd-mute">— {e.label} —</div>;
            })}
            {sim.thinking && <div className="font-mono text-[11px] text-cmd-mute cmd-blink">agent is thinking…</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); sim.submit(text); setText(""); }} className="flex items-center gap-2 border-t border-cmd-line p-3">
            <button type="button" disabled={!sim.sttSupported} onClick={sim.listening ? sim.stopListening : sim.listen} className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-md border", sim.listening ? "border-cmd-bad text-cmd-bad" : "border-cmd-line text-cmd-mute hover:text-cmd-text", !sim.sttSupported && "opacity-30")} aria-label={sim.listening ? "Stop listening" : "Speak (browser speech recognition)"} title={sim.sttSupported ? "Uses your browser's speech recognition" : "Speech recognition not supported in this browser"}>
              {sim.listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <input value={sim.interim || text} onChange={(e) => setText(e.target.value)} placeholder={started ? "Speak as the caller…" : "Type to start a call…"} className="min-w-0 flex-1 rounded-md border border-cmd-line bg-cmd-bg px-3 py-2 text-sm focus:border-cmd-violet focus:outline-none" aria-label="Caller message" />
            <Btn type="submit" variant="primary" disabled={!text.trim()} aria-label="Send"><Send size={14} /></Btn>
            <Btn type="button" onClick={sim.start} aria-label="Restart call"><RotateCcw size={14} /></Btn>
          </form>
        </Panel>

        <div className="space-y-4">
          <Panel title="Test scenarios">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
              {sim.scenarios.map((s) => (
                <button key={s.id} onClick={() => sim.runScenario(s.id)} className="flex items-center gap-2 rounded-md border border-cmd-line px-3 py-1.5 text-left text-sm hover:border-cmd-violet/60 hover:bg-cmd-raised"><Zap size={12} className="text-cmd-violet" />{s.label}</button>
              ))}
            </div>
          </Panel>
          <Panel title="State inspector">
            <dl className="space-y-1 font-mono text-[11px]">
              {[["stage", sim.state.stage], ["service", sim.state.serviceId ?? "—"], ["offered", sim.state.offered.length], ["customer", sim.state.customerName ?? "—"], ["bookings", sim.state.bookings.length], ["frustration", sim.state.frustration], ["flow node", sim.state.node]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-cmd-mute">{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Tool & guardrail trace" dense>
            <ol className="max-h-56 overflow-y-auto p-3 font-mono text-[11px] scroll-thin">
              {tools.length ? tools.map((m) => {
                const e = m.event;
                return <li key={m.id} className="border-b border-cmd-line/60 py-1 last:border-0">{e.kind === "tool" ? <span className={e.ok ? "text-cmd-cyan" : "text-cmd-bad"}>{e.ok ? "✓" : "✗"} {e.name} · {e.latencyMs}ms</span> : e.kind === "guardrail" ? <span className="text-cmd-warn">⚑ {e.rule}</span> : e.kind === "citation" ? <span className="text-cmd-mute">§ {e.entryId}</span> : null}</li>;
              }) : <li className="text-cmd-mute">No tools called yet.</li>}
            </ol>
          </Panel>
          <Panel title="Turn timing (simulated)">
            <table className="w-full font-mono text-[11px]"><thead className="text-cmd-mute"><tr><th className="text-left font-normal">turn</th><th className="text-right font-normal">agent</th><th className="text-right font-normal">tools</th></tr></thead>
              <tbody>{sim.timings.slice(-6).map((t) => <tr key={t.turn}><td>{t.turn}</td><td className="text-right">{t.agentMs}ms</td><td className="text-right">{t.toolMs}ms</td></tr>)}</tbody></table>
            <p className="mt-2 text-[11px] text-cmd-mute">Animation timings only. Real STT/LLM/TTS latency is measured in Phase 3.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
