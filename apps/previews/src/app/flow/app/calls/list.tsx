"use client";

import { clsx } from "clsx";
import { Search, ShieldAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Chip, finput, Glass, GHead, Heading } from "@/components/flow/ui";
import { CALLS, callById, transcriptFor } from "@/lib/demo-data";
import { INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { fmtDuration, fmtTime, relativeDay } from "@/lib/time";

export function CallsView({ id }: { id?: string }) {
  const sp = useSearchParams();
  const intent = sp.get("intent"), outcome = sp.get("outcome");
  const [q, setQ] = useState("");
  const [n, setN] = useState(40);
  const rows = useMemo(() => CALLS.filter((c) => (!intent || c.intent === intent) && (!outcome || c.outcome === outcome) && (!q || `${c.callerName} ${c.summary}`.toLowerCase().includes(q.toLowerCase()))), [intent, outcome, q]);
  const sel = id ? callById(id) : undefined;
  const turns = sel ? transcriptFor(sel) : [];
  const qs = sp.toString() ? `?${sp}` : "";
  return (
    <>
      <Heading kicker="Calls" title="Conversation traces"><Chip tone="amber">demo records</Chip></Heading>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_1fr]">
        <Glass className={clsx(sel && "hidden xl:block")}>
          <div className="relative p-3"><Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-flw-mute" /><input aria-label="Search calls" className={finput + " pl-8"} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {(intent || outcome) && <div className="px-4 pb-2 text-xs text-flw-cyan">Filtered: {intent && INTENT_LABEL[intent as keyof typeof INTENT_LABEL]} {outcome && `→ ${OUTCOME_LABEL[outcome as keyof typeof OUTCOME_LABEL]}`} · {rows.length} calls · <Link href="/flow/app/calls" className="underline">clear</Link></div>}
          <ul className="max-h-[70vh] overflow-y-auto">
            {rows.slice(0, n).map((c) => (
              <li key={c.id}><Link href={`/flow/app/calls/${c.id}${qs}`} className={clsx("flex items-center gap-3 border-t border-flw-line/60 px-4 py-2.5", sel?.id === c.id ? "bg-flw-violet/10" : "hover:bg-flw-surface/60")}>
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", c.outcome === "booked" ? "bg-flw-violet" : c.outcome === "transferred" || c.outcome === "message_taken" ? "bg-flw-lime" : c.outcome === "failed" || c.outcome === "no_answer" ? "bg-flw-pink" : "bg-flw-cyan")} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{c.callerName}</div><div className="truncate font-mono text-[10px] text-flw-mute">{relativeDay(c.date)} {fmtTime(c.timeMin)} · {INTENT_LABEL[c.intent]}</div></div>
                <span className="font-mono text-[10px] text-flw-mute">{fmtDuration(c.durationSec)}</span>
              </Link></li>
            ))}
          </ul>
          {n < rows.length && <button onClick={() => setN(n + 40)} className="w-full border-t border-flw-line/60 py-2 text-xs text-flw-cyan">load more</button>}
        </Glass>
        {sel ? (
          <Glass glow="violet">
            <GHead title={<span>{sel.callerName} <span className="text-flw-mute">· {sel.id}</span></span>} right={<Link href={`/flow/app/calls${qs}`} className="text-xs text-flw-mute xl:hidden">← list</Link>} />
            <div className="flex flex-wrap gap-2 px-5 pt-4"><Chip tone="violet">{INTENT_LABEL[sel.intent]}</Chip><Chip tone="cyan">{OUTCOME_LABEL[sel.outcome]}</Chip><Chip>v{sel.agentVersion}</Chip><Chip>{fmtDuration(sel.durationSec)}</Chip><Chip>p50 {sel.latencyMsP50}ms sim</Chip></div>
            <p className="px-5 pt-3 text-sm text-flw-mute">{sel.summary}</p>
            <ol className="relative m-5 border-l border-flw-line pl-6">
              {turns.map((t, i) => (
                <li key={i} className="relative pb-5">
                  <span className={clsx("absolute -left-[31px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-flw-bg", t.speaker === "agent" ? "bg-flw-violet" : t.speaker === "tool" ? (t.tool?.ok ? "bg-flw-cyan" : "bg-flw-pink") : t.speaker === "caller" ? "bg-flw-text" : "bg-flw-line")} />
                  <div className="font-mono text-[10px] text-flw-mute">{fmtDuration(t.at)} · {t.speaker}{t.interrupted ? " · interrupted" : ""}</div>
                  {t.tool ? (
                    <div className={clsx("mt-1 rounded-xl border p-3", t.tool.ok ? "border-flw-cyan/30 bg-flw-cyan/5" : "border-flw-pink/40 bg-flw-pink/5")}>
                      <div className="flex items-center gap-2 font-mono text-xs"><Wrench size={12} className={t.tool.ok ? "text-flw-cyan" : "text-flw-pink"} />{t.tool.name}</div>
                      <pre className="mt-2 overflow-x-auto font-mono text-[10px] text-flw-mute">{JSON.stringify(t.tool.args)}</pre>
                      <div className="mt-1 text-xs">{t.tool.result}</div>
                    </div>
                  ) : t.speaker === "system" ? <div className="mt-1 flex gap-2 text-xs text-flw-mute"><ShieldAlert size={12} className="mt-0.5" />{t.text}</div> : <p className={clsx("mt-1", t.speaker === "agent" ? "text-flw-text" : "text-flw-text/80")}>{t.text}</p>}
                </li>
              ))}
            </ol>
          </Glass>
        ) : <Glass className="hidden min-h-[400px] place-items-center text-sm text-flw-mute xl:grid">Select a call to see its trace.</Glass>}
      </div>
    </>
  );
}
