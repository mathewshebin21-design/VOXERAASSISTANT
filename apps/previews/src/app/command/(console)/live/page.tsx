"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Ear, PhoneForwarded, PhoneOff, Wrench } from "lucide-react";
import { Panel, PageHead, Tag } from "@/components/command/ui";
import { Waveform } from "@/components/command/waveform";
import { INTENT_LABEL } from "@/lib/metrics";
import { fmtDuration } from "@/lib/time";
import { useReplay } from "@/lib/use-replay";

export default function Live() {
  const lanes = useReplay(3);
  const active = lanes.filter((l) => !l.done).length;
  return (
    <>
      <PageHead kicker="Operate · real-time" title="Live call monitor">
        <Tag tone="warn">Simulated replay — not live calls</Tag>
      </PageHead>
      <div className="mb-4 grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
        {[["Active sessions", active], ["Queue", 0], ["Agent workers", "3 / 3 healthy"], ["Provider status", "STT · LLM · TTS — simulated"]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-cmd-line bg-cmd-panel px-3 py-2"><div className="text-[10px] uppercase tracking-[0.18em] text-cmd-mute">{k}</div><div className="mt-1 text-sm text-cmd-text">{v}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {lanes.map((l, i) => {
          const speaking = l.current?.speaker;
          const toolTurn = [...l.visible].reverse().find((t) => t.tool);
          return (
            <Panel key={i} dense title={<span className="flex items-center gap-2"><span className={clsx("h-1.5 w-1.5 rounded-full", l.done ? "bg-cmd-mute" : "bg-cmd-ok cmd-blink")} />Line {i + 1} · {l.done ? "wrapping up" : "in call"}</span>} action={<span className="font-mono text-[11px] text-cmd-mute">{fmtDuration(Math.floor(l.elapsed))}</span>}>
              <div className="border-b border-cmd-line px-4 py-3">
                <div className="flex items-center justify-between text-sm"><span className="font-medium">{l.call.callerName}</span><span className="font-mono text-[11px] text-cmd-mute">{l.call.callerNumberMasked}</span></div>
                <div className="mt-1 flex gap-2"><Tag tone="violet">{INTENT_LABEL[l.call.intent]}</Tag><Tag>agent v{l.call.agentVersion}</Tag></div>
                <div className="mt-3"><Waveform level={l.done ? 0 : speaking === "agent" ? 0.85 : speaking === "caller" ? 0.55 : 0.12} color={speaking === "caller" ? "140 140 158" : "139 92 246"} height={40} bars={48} /></div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-cmd-mute"><span>{speaking === "agent" ? "AGENT SPEAKING" : speaking === "caller" ? "CALLER SPEAKING" : speaking === "tool" ? "TOOL RUNNING" : "—"}</span><span>VAD · turn detect (sim)</span></div>
              </div>
              <div className="flex h-64 flex-col justify-end gap-2 overflow-hidden px-4 py-3" aria-live="polite">
                <AnimatePresence initial={false}>
                  {l.visible.slice(-5).map((t) => (
                    <motion.div key={t.at + t.speaker} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[13px]">
                      {t.speaker === "tool" ? (
                        <div className="flex items-start gap-2 rounded border border-cmd-cyan/30 bg-cmd-cyan/5 px-2 py-1.5 font-mono text-[11px] text-cmd-cyan"><Wrench size={12} className="mt-0.5 shrink-0" /><span>{t.tool?.name} → {t.tool?.result}</span></div>
                      ) : t.speaker === "system" ? (
                        <div className="font-mono text-[11px] text-cmd-mute">— {t.text}</div>
                      ) : (
                        <div><span className={clsx("mr-2 font-mono text-[10px] uppercase", t.speaker === "agent" ? "text-cmd-violet" : "text-cmd-mute")}>{t.speaker}</span>{t.text}</div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-cmd-line px-4 py-2.5">
                <span className="mr-auto truncate font-mono text-[10px] text-cmd-mute">{toolTurn ? `last tool: ${toolTurn.tool?.name}` : "no tools yet"}</span>
                {[[Ear, "Listen in"], [PhoneForwarded, "Take over"], [PhoneOff, "End"]].map(([Icon, label]) => {
                  const I = Icon as typeof Ear;
                  return <button key={label as string} disabled title="Requires live telephony (Phase 4)" className="inline-flex items-center gap-1 rounded border border-cmd-line px-2 py-1 text-[11px] text-cmd-mute opacity-60"><I size={12} />{label as string}</button>;
                })}
              </div>
            </Panel>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-cmd-mute">These lanes replay recorded demo transcripts on a timer to show how the monitor will behave. Supervisor controls are disabled until telephony is integrated and authorised.</p>
    </>
  );
}
