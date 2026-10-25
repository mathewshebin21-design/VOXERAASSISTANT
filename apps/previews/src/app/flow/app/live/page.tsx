"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Ear, PhoneForwarded, PhoneOff, Wrench } from "lucide-react";
import { Chip, Glass, GHead, Heading, Orb } from "@/components/flow/ui";
import { INTENT_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { fmtDuration } from "@/lib/time";
import { useReplay } from "@/lib/use-replay";

export default function Live() {
  const agent = usePreview((s) => s.draft.persona.agentName);
  const lanes = useReplay(3);
  return (
    <>
      <Heading kicker="Live" title="Calls in progress"><Chip tone="amber">simulated replay · not live calls</Chip></Heading>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Active sessions", String(lanes.filter((l) => !l.done).length)], ["Queue", "0"], ["Agent workers", "3 / 3 healthy"], ["Providers", "STT · LLM · TTS simulated"]].map(([k, v]) => (
          <Glass key={k} className="p-4"><div className="text-xs text-flw-mute">{k}</div><div className="mt-1 font-display text-xl font-semibold">{v}</div></Glass>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {lanes.map((l, i) => {
          const sp = l.current?.speaker;
          const tool = [...l.visible].reverse().find((t) => t.tool);
          return (
            <Glass key={i} glow={!l.done ? "violet" : undefined}>
              <GHead title={<span className="flex items-center gap-2"><span className={clsx("h-2 w-2 rounded-full", l.done ? "bg-flw-line" : "animate-pulse bg-flw-lime")} />Line {i + 1}</span>} right={<span className="font-mono text-xs text-flw-mute">{fmtDuration(Math.floor(l.elapsed))}</span>} />
              <div className="flex items-center gap-4 p-4">
                <Orb level={l.done ? 0 : sp === "agent" ? 0.9 : sp === "caller" ? 0.5 : 0.1} size={64} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.call.callerName}</div>
                  <div className="font-mono text-[11px] text-flw-mute">{l.call.callerNumberMasked}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5"><Chip tone="violet">{INTENT_LABEL[l.call.intent]}</Chip><Chip>v{l.call.agentVersion}</Chip></div>
                </div>
              </div>
              <div className="px-4 font-mono text-[10px] uppercase tracking-widest text-flw-mute">{sp === "agent" ? `${agent} speaking` : sp === "caller" ? "caller speaking" : sp === "tool" ? "tool running" : "—"}</div>
              <div className="flex h-60 flex-col justify-end gap-2 overflow-hidden p-4 [mask-image:linear-gradient(to_bottom,transparent,black_20%)]" aria-live="polite">
                <AnimatePresence initial={false}>
                  {l.visible.slice(-5).map((t) => (
                    <motion.div key={t.at + t.speaker} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm">
                      {t.tool ? <div className={clsx("flex items-start gap-2 rounded-xl border px-2.5 py-1.5 font-mono text-[11px]", t.tool.ok ? "border-flw-cyan/30 bg-flw-cyan/5 text-flw-cyan" : "border-flw-pink/40 text-flw-pink")}><Wrench size={12} className="mt-0.5 shrink-0" />{t.tool.name} → {t.tool.result}</div>
                        : t.speaker === "system" ? <div className="font-mono text-[11px] text-flw-mute">— {t.text}</div>
                        : <div><span className={clsx("mr-2 font-mono text-[10px] uppercase", t.speaker === "agent" ? "text-flw-violet" : "text-flw-mute")}>{t.speaker === "agent" ? agent : "caller"}</span>{t.text}</div>}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-flw-line/70 p-3">
                <span className="mr-auto truncate font-mono text-[10px] text-flw-mute">{tool ? `last tool: ${tool.tool?.name}` : "no tools yet"}</span>
                {([[Ear, "Listen in"], [PhoneForwarded, "Take over"], [PhoneOff, "End"]] as const).map(([I, label]) => (
                  <button key={label} disabled title="Requires live telephony (Phase 4)" className="inline-flex items-center gap-1 rounded-lg border border-flw-line px-2 py-1 text-[11px] text-flw-mute opacity-60"><I size={12} />{label}</button>
                ))}
              </div>
            </Glass>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-flw-mute">Recorded demo transcripts replayed on a timer. Supervisor controls are disabled until telephony is integrated and authorised.</p>
    </>
  );
}
