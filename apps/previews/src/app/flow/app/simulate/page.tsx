"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, Play, RotateCcw, Send, ShieldAlert, Volume2, VolumeX, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlowCanvas } from "@/components/flow/canvas";
import { useRecordSimulatedUsage } from "@/components/flow/live-usage";
import { Chip, FBtn, FSwitch, Glass, GHead, Orb } from "@/components/flow/ui";
import { useSimulator } from "@/lib/use-simulator";

export default function Simulate() {
  const sim = useSimulator();
  useRecordSimulatedUsage(sim.messages.length);
  const [text, setText] = useState("");
  const [visited, setVisited] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sim.messages]);
  useEffect(() => {
    if (!sim.messages.length) { setVisited([]); return; }
    setVisited((v) => {
      const base = v.length ? [...v] : ["persona", "greet"];
      if (sim.state.node !== "greet" && !base.includes("intent")) base.push("intent");
      return base.includes(sim.state.node) ? base : [...base, sim.state.node];
    });
  }, [sim.state.node, sim.messages.length]);
  const tools = useMemo(() => sim.messages.filter((m) => m.event.kind === "tool" || m.event.kind === "guardrail"), [sim.messages]);
  const live = sim.messages.length > 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
      <Glass glow="violet" className="flex h-[calc(100vh-130px)] min-h-[560px] flex-col">
        <div className="flex items-center gap-4 border-b border-flw-line/70 p-4">
          <Orb level={sim.speaking ? sim.level : sim.listening ? 0.5 : 0.08} size={64} />
          <div className="min-w-0 flex-1">
            <div className="font-display font-medium">Simulated call</div>
            <div className="font-mono text-[11px] text-flw-mute">{sim.speaking ? "agent speaking · type to interrupt" : sim.thinking ? "thinking" : live ? `node: ${sim.state.node}` : "idle"}</div>
          </div>
          <button onClick={() => sim.setTts(!sim.tts)} disabled={!sim.ttsSupported} className="text-flw-mute hover:text-flw-text disabled:opacity-30" aria-label={sim.tts ? "Mute browser voice" : "Speak replies"}>{sim.tts ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {!live && <div className="grid h-full place-items-center"><FBtn variant="glow" onClick={sim.start}><Play size={14} /> Start simulation</FBtn></div>}
          <AnimatePresence initial={false}>
            {sim.messages.map((m) => {
              const e = m.event;
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  {e.kind === "caller" ? <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-flw-line/70 px-3.5 py-2 text-sm">{e.text}</div>
                    : e.kind === "agent" ? <div className={clsx("max-w-[88%] rounded-2xl rounded-bl-md border border-flw-violet/40 bg-flw-violet/10 px-3.5 py-2 text-sm", m.interrupted && "border-flw-amber/50")}>{e.text.slice(0, m.shown ?? e.text.length)}{m.interrupted && <span className="ml-1 font-mono text-[10px] text-flw-amber">✂ interrupted</span>}</div>
                    : e.kind === "tool" ? <div className={clsx("flex items-center gap-2 font-mono text-[11px]", e.ok ? "text-flw-cyan" : "text-flw-pink")}><Wrench size={12} />{e.name} {e.ok ? "✓" : "✗"}</div>
                    : e.kind === "guardrail" ? <div className="flex items-start gap-2 font-mono text-[11px] text-flw-amber"><ShieldAlert size={12} className="mt-0.5" />{e.rule}</div>
                    : e.kind === "citation" ? <div className="font-mono text-[10px] text-flw-mute">§ {e.title} v{e.version}</div>
                    : <div className="text-center font-mono text-[10px] uppercase tracking-widest text-flw-mute">{e.label}</div>}
                </motion.div>
              );
            })}
          </AnimatePresence>
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); sim.submit(text); setText(""); }} className="flex items-center gap-2 border-t border-flw-line/70 p-3">
          <button type="button" onClick={sim.listening ? sim.stopListening : sim.listen} disabled={!sim.sttSupported} className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-flw-line", sim.listening && "border-flw-pink text-flw-pink", !sim.sttSupported && "opacity-30")} aria-label="Speak (browser speech recognition)"><Mic size={15} /></button>
          <input aria-label="Caller message" value={sim.interim || text} onChange={(e) => setText(e.target.value)} placeholder="Message as the caller…" className="min-w-0 flex-1 rounded-xl border border-flw-line bg-flw-bg/70 px-3 py-2 text-sm outline-none focus:border-flw-cyan" />
          <FBtn type="submit" variant="glow" aria-label="Send" disabled={!text.trim()}><Send size={14} /></FBtn>
          <FBtn type="button" onClick={sim.start} aria-label="Restart"><RotateCcw size={14} /></FBtn>
        </form>
      </Glass>

      <div className="min-w-0 space-y-4">
        <FlowCanvas active={live ? sim.state.node : undefined} visited={visited} height={540} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Glass>
            <GHead title="Tool execution" right={<div className="flex items-center gap-2 text-xs text-flw-mute">fail tools <FSwitch label="Simulate provider failures" on={sim.failTools} onChange={sim.setFailTools} /></div>} />
            <ol className="max-h-64 space-y-2 overflow-y-auto p-4">
              {tools.length ? tools.map((m) => {
                const e = m.event;
                if (e.kind === "tool") return (
                  <li key={m.id} className={clsx("rounded-xl border p-2.5", e.ok ? "border-flw-cyan/30 bg-flw-cyan/5" : "border-flw-pink/40 bg-flw-pink/5")}>
                    <div className="flex items-center justify-between font-mono text-xs"><span className={e.ok ? "text-flw-cyan" : "text-flw-pink"}>{e.name}</span><span className="text-flw-mute">{e.latencyMs}ms</span></div>
                    <div className="mt-1 truncate font-mono text-[10px] text-flw-mute">{JSON.stringify(e.args)}</div>
                    <div className="mt-1 text-xs">{e.result}</div>
                  </li>
                );
                if (e.kind === "guardrail") return <li key={m.id} className="rounded-xl border border-flw-amber/40 bg-flw-amber/5 p-2.5 text-xs text-flw-amber"><span className="font-mono">{e.rule}</span> — {e.text}</li>;
                return null;
              }) : <li className="text-sm text-flw-mute">Tool calls appear here with their validated arguments.</li>}
            </ol>
          </Glass>
          <Glass>
            <GHead title="Scenarios" right={<Chip tone="amber">rule-based stand-in</Chip>} />
            <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
              {sim.scenarios.map((s) => <button key={s.id} onClick={() => { setVisited([]); sim.runScenario(s.id); }} className="rounded-xl border border-flw-line bg-flw-surface/60 px-3 py-2 text-left text-sm hover:border-flw-violet/60">{s.label}</button>)}
            </div>
          </Glass>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Glass>
            <GHead title="State inspector" />
            <dl className="space-y-1 p-4 font-mono text-[11px]">
              {[["stage", sim.state.stage], ["service", sim.state.serviceId ?? "—"], ["offered", sim.state.offered.length], ["customer", sim.state.customerName ?? "—"], ["bookings", sim.state.bookings.length], ["frustration", sim.state.frustration], ["flow node", sim.state.node]].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between"><dt className="text-flw-mute">{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          </Glass>
          <Glass>
            <GHead title="Turn timing (simulated)" />
            <div className="p-4">
              <table className="w-full font-mono text-[11px]"><thead className="text-flw-mute"><tr><th className="text-left font-normal">turn</th><th className="text-right font-normal">agent</th><th className="text-right font-normal">tools</th></tr></thead>
                <tbody>{sim.timings.slice(-6).map((t) => <tr key={t.turn}><td>{t.turn}</td><td className="text-right">{t.agentMs}ms</td><td className="text-right">{t.toolMs}ms</td></tr>)}</tbody></table>
              <p className="mt-2 text-[11px] text-flw-mute">Animation timings only; real STT/LLM/TTS latency is measured in Phase 3.</p>
            </div>
          </Glass>
        </div>
      </div>
    </div>
  );
}
