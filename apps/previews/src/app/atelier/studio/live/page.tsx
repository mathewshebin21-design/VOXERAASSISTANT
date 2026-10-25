"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Ear, PhoneForwarded, PhoneOff } from "lucide-react";
import { Card, DemoNote, Eyebrow, Pill, Title } from "@/components/atelier/ui";
import { INTENT_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { fmtDuration } from "@/lib/time";
import { useReplay } from "@/lib/use-replay";

function Bars({ level, tone }: { level: number; tone: "agent" | "caller" | "idle" }) {
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <motion.span key={i} className={clsx("w-[3px] rounded-full", tone === "agent" ? "bg-atl-champdeep" : tone === "caller" ? "bg-atl-ink/50" : "bg-atl-line")}
          animate={{ height: level > 0.1 ? [4, 6 + ((i * 7) % 22) * level, 4] : 3 }} transition={{ repeat: level > 0.1 ? Infinity : 0, duration: 0.45 + (i % 5) * 0.1 }} />
      ))}
    </div>
  );
}

export default function Live() {
  const agent = usePreview((s) => s.draft.persona.agentName);
  const lanes = useReplay(3);
  const active = lanes.filter((l) => !l.done).length;
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Live</Eyebrow><Title className="mt-4">On the line right now.</Title></div>
        <Pill tone="champ">Replay of demo calls — not live</Pill>
      </div>
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-atl-line bg-atl-line md:grid-cols-4">
        {[["Conversations", String(active)], ["Waiting", "0"], ["Receptionist lines", "3 of 3 ready"], ["Voice services", "Simulated"]].map(([k, v]) => (
          <div key={k} className="bg-atl-paper p-6"><div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{k}</div><div className="mt-2 font-serif text-3xl">{v}</div></div>
        ))}
      </section>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {lanes.map((l, i) => {
          const sp = l.current?.speaker;
          const tool = [...l.visible].reverse().find((t) => t.tool);
          return (
            <Card key={i} className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-atl-soft">Line {i + 1} · {l.done ? "wrapping up" : "in conversation"}</div>
                  <div className="mt-2 font-serif text-2xl">{l.call.callerName}</div>
                  <div className="text-xs text-atl-soft">{l.call.callerNumberMasked}</div>
                </div>
                <span className="font-serif text-xl text-atl-soft">{fmtDuration(Math.floor(l.elapsed))}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><Pill tone="champ">{INTENT_LABEL[l.call.intent]}</Pill><Pill>Edition {l.call.agentVersion}</Pill></div>
              <div className="mt-5 flex items-center gap-4">
                <Bars level={l.done ? 0 : sp === "agent" ? 0.9 : sp === "caller" ? 0.6 : 0.05} tone={sp === "agent" ? "agent" : sp === "caller" ? "caller" : "idle"} />
                <span className="text-xs italic text-atl-soft">{sp === "agent" ? `${agent} is speaking` : sp === "caller" ? "caller is speaking" : sp === "tool" ? `${agent} is checking…` : "—"}</span>
              </div>
              <div className="mt-5 flex h-60 flex-col justify-end gap-3 overflow-hidden border-t border-atl-line pt-4 [mask-image:linear-gradient(to_bottom,transparent,black_22%)]" aria-live="polite">
                <AnimatePresence initial={false}>
                  {l.visible.slice(-4).map((t) => (
                    <motion.div key={t.at + t.speaker} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      {t.tool ? <p className={clsx("text-sm italic", t.tool.ok ? "text-atl-champdeep" : "text-atl-rose")}>{agent} used {t.tool.name.replaceAll("_", " ")} — {t.tool.result}</p>
                        : t.speaker === "system" ? <p className="text-[11px] uppercase tracking-[0.18em] text-atl-soft">{t.text}</p>
                        : <p className={t.speaker === "agent" ? "font-serif text-lg leading-snug" : "text-[15px] text-atl-soft"}><span className="mr-2 text-[10px] uppercase tracking-[0.2em] text-atl-soft">{t.speaker === "agent" ? agent : "Caller"}</span>{t.text}</p>}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-atl-line pt-4">
                <span className="mr-auto text-xs text-atl-soft">{tool ? `Last action: ${tool.tool?.name.replaceAll("_", " ")}` : "No actions yet"}</span>
                {([[Ear, "Listen in"], [PhoneForwarded, "Take over"], [PhoneOff, "End"]] as const).map(([I, label]) => (
                  <button key={label} disabled title="Needs a live phone line (Phase 4)" className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-atl-soft opacity-60 ring-1 ring-atl-line"><I size={12} />{label}</button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <DemoNote>These lines replay recorded demo conversations on a timer to show how the live view will feel. Listening in and taking over are switched off until a real phone line is connected and approved.</DemoNote>
    </div>
  );
}
