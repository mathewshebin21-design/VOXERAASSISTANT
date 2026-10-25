"use client";

import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Btn, inputCls, PageHead, Panel, Tag } from "@/components/command/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { fmtDate, fmtDuration, fmtTime, gbp } from "@/lib/time";
import type { CallOutcome, CallRecord, Intent } from "@/lib/types";

const PAGE = 25;

function tone(o: CallOutcome) {
  return o === "booked" || o === "rescheduled" ? "violet" : o === "transferred" ? "cyan" : o === "failed" || o === "no_answer" || o === "abandoned" ? "bad" : o === "message_taken" ? "warn" : "mute";
}

function CallsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const outcome = sp.get("outcome") as CallOutcome | null;
  const intent = sp.get("intent") as Intent | null;
  const status = sp.get("status");

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    setPage(0);
    router.replace(`/command/calls${p.size ? "?" + p : ""}`);
  };

  const rows = useMemo(() => CALLS.filter((c: CallRecord) =>
    (!outcome || c.outcome === outcome) && (!intent || c.intent === intent) && (!status || c.status === status) &&
    (!q || `${c.callerName} ${c.summary} ${c.id}`.toLowerCase().includes(q.toLowerCase()))), [outcome, intent, status, q]);
  const m = computeMetrics(rows);

  const exportCsv = () => {
    const head = "id,date,time,caller,status,outcome,intent,duration_sec,cost_gbp,source";
    const body = rows.map((c) => [c.id, c.date, fmtTime(c.timeMin), c.callerName, c.status, c.outcome, c.intent, c.durationSec, c.costGBP, c.source].join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([head + "\n" + body], { type: "text/csv" }));
    a.download = "voxera-demo-calls.csv";
    a.click();
  };

  return (
    <>
      <PageHead kicker="Operate · records" title="Calls & transcripts">
        <Btn onClick={exportCsv}><Download size={14} /> Export CSV</Btn>
      </PageHead>
      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 border-b border-cmd-line p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cmd-mute" />
            <input className={inputCls + " pl-8"} placeholder="Search caller, summary, ID…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search calls" />
          </div>
          <select aria-label="Outcome" className={inputCls + " w-auto"} value={outcome ?? ""} onChange={(e) => setParam("outcome", e.target.value)}>
            <option value="">All outcomes</option>
            {Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Intent" className={inputCls + " w-auto"} value={intent ?? ""} onChange={(e) => setParam("intent", e.target.value)}>
            <option value="">All intents</option>
            {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Status" className={inputCls + " w-auto"} value={status ?? ""} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Any status</option><option value="answered">Answered</option><option value="missed">Missed</option><option value="voicemail">Voicemail</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-cmd-line px-4 py-2 font-mono text-[11px] text-cmd-mute">
          <span>{rows.length} calls</span><span>{m.totalMinutes.toFixed(0)} min</span><span>avg {fmtDuration(m.avgDurationSec)}</span><span>sim. cost {gbp(m.totalCostGBP)}</span>
          {(outcome || intent || status) && <span className="text-cmd-violet">Evidence view: these records produce the filtered aggregate.</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.15em] text-cmd-mute">
              <tr className="text-left"><th className="px-4 py-2">When</th><th className="px-2">Caller</th><th className="px-2">Intent</th><th className="px-2">Outcome</th><th className="px-2">Summary</th><th className="px-2 text-right">Dur.</th><th className="px-4 text-right">p50</th></tr>
            </thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
                <tr key={c.id} className="border-t border-cmd-line hover:bg-cmd-raised/60">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-cmd-mute">{fmtDate(c.date)} {fmtTime(c.timeMin)}</td>
                  <td className="px-2"><Link href={`/command/calls/${c.id}`} className="font-medium hover:text-cmd-violet">{c.callerName}</Link><div className="font-mono text-[10px] text-cmd-mute">{c.callerNumberMasked}</div></td>
                  <td className="px-2 text-cmd-mute">{INTENT_LABEL[c.intent]}</td>
                  <td className="px-2"><Tag tone={tone(c.outcome)}>{OUTCOME_LABEL[c.outcome]}</Tag></td>
                  <td className="max-w-[320px] truncate px-2 text-cmd-mute" title={c.summary}>{c.summary}</td>
                  <td className="px-2 text-right font-mono text-xs">{fmtDuration(c.durationSec)}</td>
                  <td className="px-4 text-right font-mono text-xs text-cmd-mute">{c.latencyMsP50 || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-cmd-line px-4 py-2 text-xs text-cmd-mute">
          <span>Page {page + 1} of {Math.max(1, Math.ceil(rows.length / PAGE))}</span>
          <div className="flex gap-2">
            <Btn disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Btn>
            <Btn disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage((p) => p + 1)}>Next</Btn>
          </div>
        </div>
      </Panel>
    </>
  );
}

export default function Calls() {
  return <Suspense><CallsInner /></Suspense>;
}
