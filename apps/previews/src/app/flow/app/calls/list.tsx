"use client";

import { clsx } from "clsx";
import { ChevronDown, Download, EyeOff, FileSpreadsheet, Pause, Play, Search, ShieldAlert, ShieldCheck, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Chip, FBtn, finput, Glass, GHead, Heading } from "@/components/flow/ui";
import { APPOINTMENTS, CALLS, callById, serviceById, staffById, transcriptFor } from "@/lib/demo-data";
import { computeMetrics, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { fmtDate, fmtDuration, fmtTime, gbp, relativeDay } from "@/lib/time";

export function CallsView({ id }: { id?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const intent = sp.get("intent") ?? "", outcome = sp.get("outcome") ?? "", status = sp.get("status") ?? "";
  const [q, setQ] = useState("");
  const [n, setN] = useState(40);
  const rows = useMemo(() => CALLS.filter((c) => (!intent || c.intent === intent) && (!outcome || c.outcome === outcome) && (!status || c.status === status) && (!q || `${c.callerName} ${c.summary} ${c.id}`.toLowerCase().includes(q.toLowerCase()))), [intent, outcome, status, q]);
  const m = useMemo(() => computeMetrics(rows), [rows]);
  const sel = id ? callById(id) : undefined;
  const qs = sp.toString() ? `?${sp}` : "";
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    setN(40);
    router.replace(`/flow/app/calls${p.size ? `?${p}` : ""}`);
  };
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
      <Heading kicker="Calls" title="Conversation traces"><FBtn onClick={exportCsv}><FileSpreadsheet size={14} /> Export CSV</FBtn><Chip tone="amber">demo records</Chip></Heading>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-flw-mute" /><input aria-label="Search calls" className={finput + " pl-8"} placeholder="Search caller, summary, ID…" value={q} onChange={(e) => { setQ(e.target.value); setN(40); }} /></div>
        <select aria-label="Outcome" className={finput + " w-auto"} value={outcome} onChange={(e) => setParam("outcome", e.target.value)}><option value="">All outcomes</option>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Intent" className={finput + " w-auto"} value={intent} onChange={(e) => setParam("intent", e.target.value)}><option value="">All intents</option>{Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Status" className={finput + " w-auto"} value={status} onChange={(e) => setParam("status", e.target.value)}><option value="">Any status</option><option value="answered">Answered</option><option value="missed">Missed</option><option value="voicemail">Voicemail</option></select>
      </div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-flw-mute">
        <span>{rows.length} calls</span><span>{m.totalMinutes.toFixed(0)} min</span><span>avg {fmtDuration(m.avgDurationSec)}</span><span>est. cost {gbp(m.totalCostGBP)}</span>
        {(intent || outcome || status) && <span className="text-flw-cyan">evidence view — these records produce the selected figure · <Link href="/flow/app/calls" className="underline">clear</Link></span>}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_1fr]">
        <Glass className={clsx(sel && "hidden xl:block")}>
          <ul className="max-h-[75vh] overflow-y-auto">
            {rows.slice(0, n).map((c) => (
              <li key={c.id}><Link href={`/flow/app/calls/${c.id}${qs}`} className={clsx("flex items-center gap-3 border-t border-flw-line/60 px-4 py-2.5 first:border-0", sel?.id === c.id ? "bg-flw-violet/10" : "hover:bg-flw-surface/60")}>
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", c.outcome === "booked" ? "bg-flw-violet" : c.outcome === "transferred" || c.outcome === "message_taken" ? "bg-flw-lime" : c.outcome === "failed" || c.outcome === "no_answer" ? "bg-flw-pink" : "bg-flw-cyan")} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{c.callerName}</div><div className="truncate font-mono text-[10px] text-flw-mute">{relativeDay(c.date)} {fmtTime(c.timeMin)} · {INTENT_LABEL[c.intent]} → {OUTCOME_LABEL[c.outcome]}</div></div>
                <span className="font-mono text-[10px] text-flw-mute">{fmtDuration(c.durationSec)}</span>
              </Link></li>
            ))}
            {!rows.length && <li className="p-4 text-sm text-flw-mute">No calls match.</li>}
          </ul>
          {n < rows.length && <button onClick={() => setN(n + 40)} className="w-full border-t border-flw-line/60 py-2 text-xs text-flw-cyan">load more</button>}
        </Glass>
        {sel ? <Trace key={sel.id} id={sel.id} back={`/flow/app/calls${qs}`} /> : <Glass className="hidden min-h-[400px] place-items-center text-sm text-flw-mute xl:grid">Select a call to see its trace.</Glass>}
      </div>
    </>
  );
}

function Trace({ id, back }: { id: string; back: string }) {
  const c = callById(id)!;
  const turns = useMemo(() => transcriptFor(c), [c]);
  const end = Math.max(c.durationSec, (turns.at(-1)?.at ?? 0) + 2);
  const [t, setT] = useState(end);
  const [playing, setPlaying] = useState(false);
  const [masked, setMasked] = useState(false);
  const [gone, setGone] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const retention = usePreview((s) => s.draft.retentionDays);
  const agent = usePreview((s) => s.draft.persona.agentName);
  const appt = c.appointmentId ? APPOINTMENTS.find((a) => a.id === c.appointmentId) : undefined;
  const names = [c.callerName, c.callerName.split(" ")[0]];
  const mask = (s: string) => (masked ? names.reduce((x, nm) => x.replaceAll(nm, "[name]"), s).replace(/\+44[\d\s•]+/g, "[number]") : s);
  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setT((x) => { if (x >= end) { setPlaying(false); return end; } return x + 0.5; }), 125);
    return () => clearInterval(i);
  }, [playing, end]);
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ call: c, transcript: turns }, null, 2)], { type: "application/json" })); a.download = `${c.id}.json`; a.click(); };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[1fr_300px]">
      <Glass glow="violet">
        <GHead title={<span>{masked ? "[name]" : c.callerName} <span className="text-flw-mute">· {c.id}</span></span>} right={<Link href={back} className="text-xs text-flw-mute xl:hidden">← list</Link>} />
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <Chip tone="violet">{INTENT_LABEL[c.intent]}</Chip><Chip tone="cyan">{OUTCOME_LABEL[c.outcome]}</Chip><Chip>v{c.agentVersion}</Chip>{c.tags.map((tg) => <Chip key={tg} tone="amber">{tg}</Chip>)}
          <div className="ml-auto flex gap-1">
            <FBtn onClick={() => setMasked(!masked)} aria-pressed={masked}><EyeOff size={13} /> {masked ? "Show PII" : "Redact PII"}</FBtn>
            <FBtn onClick={download}><Download size={13} /> JSON</FBtn>
            <FBtn aria-label="Delete transcript" onClick={() => confirm("Delete this transcript? (Preview: only hides it in this session.)") && setGone(true)}><Trash2 size={13} /></FBtn>
          </div>
        </div>
        <p className="px-5 pt-3 text-sm text-flw-mute">{mask(c.summary)}</p>
        {gone ? <p className="p-8 text-center text-sm text-flw-mute">Transcript deleted. In production this writes an audit entry and purges the recording and transcript.</p> : (
          <>
            <div className="flex items-center gap-3 px-5 pt-4">
              <button onClick={() => { if (t >= end) setT(0); setPlaying((x) => !x); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-flw-violet to-flw-cyan text-flw-bg" aria-label={playing ? "Pause replay" : "Replay transcript"}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <input type="range" min={0} max={end} step={0.5} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} className="flex-1 accent-[rgb(var(--flw-cyan))]" aria-label="Transcript position" />
              <span className="w-24 text-right font-mono text-xs text-flw-mute">{fmtDuration(Math.floor(t))} / {fmtDuration(end)}</span>
            </div>
            <ol className="relative m-5 border-l border-flw-line pl-6">
              {turns.map((turn, i) => (
                <li key={i} className={clsx("relative pb-5 transition", turn.at > t && "opacity-25")}>
                  <span className={clsx("absolute -left-[31px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-flw-bg", turn.speaker === "agent" ? "bg-flw-violet" : turn.speaker === "tool" ? (turn.tool?.ok ? "bg-flw-cyan" : "bg-flw-pink") : turn.speaker === "caller" ? "bg-flw-text" : "bg-flw-line")} />
                  <div className="font-mono text-[10px] text-flw-mute">{fmtDuration(turn.at)} · {turn.speaker === "agent" ? agent : turn.speaker}{turn.interrupted ? " · interrupted" : ""}</div>
                  {turn.tool ? (
                    <div className={clsx("mt-1 rounded-xl border p-3", turn.tool.ok ? "border-flw-cyan/30 bg-flw-cyan/5" : "border-flw-pink/40 bg-flw-pink/5")}>
                      <button className="flex w-full items-center gap-2 text-left font-mono text-xs" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}><Wrench size={12} className={turn.tool.ok ? "text-flw-cyan" : "text-flw-pink"} />{turn.tool.name}<span className="truncate text-flw-mute">→ {mask(turn.tool.result)}</span><ChevronDown size={12} className={clsx("ml-auto shrink-0 transition", open === i && "rotate-180")} /></button>
                      {open === i && <pre className="mt-2 overflow-x-auto font-mono text-[10px] text-flw-mute">{mask(JSON.stringify(turn.tool.args, null, 2))}</pre>}
                    </div>
                  ) : turn.speaker === "system" ? <div className="mt-1 flex gap-2 text-xs text-flw-mute"><ShieldAlert size={12} className="mt-0.5" />{mask(turn.text)}</div> : <p className="mt-1">{mask(turn.text)}</p>}
                </li>
              ))}
            </ol>
            <p className="px-5 pb-4 font-mono text-[10px] text-flw-mute">Replay steps through the text timeline; no audio is stored for demo calls.</p>
          </>
        )}
      </Glass>
      <div className="space-y-4">
        <Glass>
          <GHead title="Call facts" />
          <dl className="grid grid-cols-2 gap-y-2 p-4 text-sm">
            {[["When", `${fmtDate(c.date)} ${fmtTime(c.timeMin)}`], ["Duration", fmtDuration(c.durationSec)], ["Number", masked ? "[number]" : c.callerNumberMasked], ["Sentiment", c.sentiment], ["Latency p50", c.latencyMsP50 ? `${c.latencyMsP50}ms sim` : "—"], ["Cost", `${gbp(c.costGBP, 3)} est.`], ["Source", "Demo"]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-xs text-flw-mute">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
          </dl>
        </Glass>
        {appt && (
          <Glass>
            <GHead title="Linked appointment" />
            <div className="p-4 text-sm"><div className="font-medium">{serviceById(appt.serviceId).name}</div><div className="text-flw-mute">{fmtDate(appt.date)} · {fmtTime(appt.startMin)} · {staffById(appt.staffId).name}</div><div className="mt-2"><Chip tone="violet">{appt.status.replace("_", " ")}</Chip></div></div>
          </Glass>
        )}
        <Glass>
          <GHead title="Compliance" />
          <ul className="space-y-1.5 p-4 text-sm text-flw-mute">
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 text-flw-lime" />AI identity disclosed in greeting</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 text-flw-lime" />Recording notice before capture</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 text-flw-lime" />Auto-delete after {retention} days</li>
          </ul>
        </Glass>
      </div>
    </div>
  );
}
