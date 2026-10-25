"use client";

import { clsx } from "clsx";
import { ChevronDown, Download, EyeOff, FileSpreadsheet, Pause, Play, Search, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, DemoNote, Eyebrow, field, Pill, Title } from "./ui";
import { APPOINTMENTS, CALLS, callById, serviceById, staffById, transcriptFor } from "@/lib/demo-data";
import { computeMetrics, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { fmtDate, fmtDuration, fmtTime, gbp, relativeDay } from "@/lib/time";
import type { CallOutcome, CallRecord, Intent } from "@/lib/types";

const FILTERS: [string, CallOutcome | ""][] = [["Everything", ""], ["Booked", "booked"], ["Moved", "rescheduled"], ["Cancelled", "cancelled"], ["Questions", "answered_question"], ["Handed over", "transferred"], ["Messages", "message_taken"], ["Abandoned", "abandoned"], ["Unfinished", "failed"], ["Missed", "no_answer"]];

export function Journal({ selectedId }: { selectedId?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const outcome = (sp.get("outcome") ?? "") as CallOutcome | "";
  const intent = (sp.get("intent") ?? "") as Intent | "";
  const status = sp.get("status") ?? "";
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(30);
  const rows = useMemo(() => CALLS.filter((c: CallRecord) =>
    (!outcome || c.outcome === outcome) && (!intent || c.intent === intent) && (!status || c.status === status) &&
    (!q || `${c.callerName} ${c.summary} ${c.id}`.toLowerCase().includes(q.toLowerCase()))), [outcome, intent, status, q]);
  const m = useMemo(() => computeMetrics(rows), [rows]);
  const sel = selectedId ? callById(selectedId) : undefined;
  const qs = sp.toString() ? `?${sp}` : "";

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    setLimit(30);
    router.replace(`/atelier/studio/calls${p.size ? `?${p}` : ""}`);
  };

  const exportCsv = () => {
    const head = "id,date,time,caller,status,outcome,intent,duration_sec,cost_gbp,source";
    const body = rows.map((c) => [c.id, c.date, fmtTime(c.timeMin), c.callerName, c.status, c.outcome, c.intent, c.durationSec, c.costGBP, c.source].join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([head + "\n" + body], { type: "text/csv" }));
    a.download = "voxera-demo-journal.csv";
    a.click();
  };

  // Group by day for an editorial, journal-like list.
  const groups = useMemo(() => {
    const g = new Map<string, typeof rows>();
    for (const c of rows.slice(0, limit)) g.set(c.date, [...(g.get(c.date) ?? []), c]);
    return [...g.entries()];
  }, [rows, limit]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Journal</Eyebrow><Title className="mt-4">Every conversation, written down.</Title></div>
        <Button variant="outline" onClick={exportCsv}><FileSpreadsheet size={15} /> Export as spreadsheet</Button>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {FILTERS.map(([l, k]) => (
          <button key={l} onClick={() => setParam("outcome", k)} className={clsx("whitespace-nowrap rounded-full px-4 py-2 text-sm ring-1", outcome === k ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line hover:ring-atl-champ")}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-atl-soft" /><input aria-label="Search conversations" className={field + " pl-10"} placeholder="Search by name or what was said…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(30); }} /></div>
        <select aria-label="Reason for calling" value={intent} onChange={(e) => setParam("intent", e.target.value)} className="rounded-full border border-atl-line bg-atl-paper px-4 py-2.5 text-sm">
          <option value="">Any reason</option>{Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Answered or missed" value={status} onChange={(e) => setParam("status", e.target.value)} className="rounded-full border border-atl-line bg-atl-paper px-4 py-2.5 text-sm">
          <option value="">Answered or not</option><option value="answered">Answered</option><option value="missed">Missed</option><option value="voicemail">Voicemail</option>
        </select>
      </div>
      <p className="text-sm text-atl-soft">
        {rows.length} conversations · {m.totalMinutes.toFixed(0)} minutes · average {fmtDuration(m.avgDurationSec)} · estimated cost {gbp(m.totalCostGBP)}
        {(outcome || intent || status) ? " — these are the records behind the figure you selected." : "."} Demo records only.
      </p>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
        <div className={clsx(sel && "hidden lg:block")}>
          {groups.map(([day, cs]) => (
            <section key={day} className="mb-6">
              <div className="mb-2 font-serif text-lg italic text-atl-champdeep">{relativeDay(day)}</div>
              <ul className="divide-y divide-atl-line border-y border-atl-line">
                {cs.map((c) => (
                  <li key={c.id}>
                    <Link href={`/atelier/studio/calls/${c.id}${qs}`} className={clsx("flex items-start gap-3 px-2 py-3 transition", sel?.id === c.id ? "bg-atl-paper" : "hover:bg-atl-paper/60")}>
                      <span className="w-12 pt-0.5 text-sm text-atl-soft">{fmtTime(c.timeMin)}</span>
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.callerName}</div><div className="line-clamp-1 text-sm text-atl-soft">{c.summary}</div></div>
                      <Pill tone={c.outcome === "booked" ? "champ" : c.outcome === "failed" || c.outcome === "no_answer" ? "rose" : "plain"}>{OUTCOME_LABEL[c.outcome]}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!rows.length && <p className="text-atl-soft">Nothing matches — try a different filter.</p>}
          {limit < rows.length && <Button variant="outline" onClick={() => setLimit((l) => l + 30)}>Show earlier</Button>}
        </div>
        <div>
          {sel ? <Reading key={sel.id} id={sel.id} agent={agent} back={`/atelier/studio/calls${qs}`} /> : (
            <Card className="hidden h-full min-h-[300px] place-items-center p-10 text-center lg:grid"><div><div className="font-serif text-2xl">Choose a conversation</div><p className="mt-2 text-sm text-atl-soft">Its transcript opens here.</p></div></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Reading({ id, agent, back }: { id: string; agent: string; back: string }) {
  const c = callById(id)!;
  const turns = useMemo(() => transcriptFor(c), [c]);
  const end = Math.max(c.durationSec, (turns.at(-1)?.at ?? 0) + 2);
  const [t, setT] = useState(end);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [masked, setMasked] = useState(false);
  const [gone, setGone] = useState(false);
  const retention = usePreview((s) => s.draft.retentionDays);
  const recording = usePreview((s) => s.draft.persona.recordingDisclosure);
  const appt = c.appointmentId ? APPOINTMENTS.find((a) => a.id === c.appointmentId) : undefined;
  const mask = (s: string) => (masked ? s.replaceAll(c.callerName, "the caller").replaceAll(c.callerName.split(" ")[0], "the caller").replace(/\+44[\d\s•]+/g, "[number]") : s);

  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setT((x) => { if (x >= end) { setPlaying(false); return end; } return x + 0.5; }), 125);
    return () => clearInterval(i);
  }, [playing, end]);

  const facts: [string, string][] = [
    ["When", `${fmtDate(c.date)}, ${fmtTime(c.timeMin)}`], ["Length", fmtDuration(c.durationSec)], ["Number", masked ? "[number]" : c.callerNumberMasked],
    ["Edition", `${c.agentVersion}`], ["Mood", c.sentiment], ["Response time", c.latencyMsP50 ? `${c.latencyMsP50} ms (simulated)` : "—"],
    ["Estimated cost", gbp(c.costGBP, 3)], ["Source", "Demo record"],
  ];

  return (
    <Card as="article" className="p-6 sm:p-10">
      <Link href={back} className="text-sm text-atl-soft lg:hidden">← Journal</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-atl-soft">{relativeDay(c.date)} at {fmtTime(c.timeMin)} · {fmtDuration(c.durationSec)}</div>
          <h2 className="mt-1 font-serif text-4xl">{masked ? "A caller" : c.callerName}</h2>
          <div className="mt-3 flex flex-wrap gap-2"><Pill tone="champ">{INTENT_LABEL[c.intent]}</Pill><Pill>{OUTCOME_LABEL[c.outcome]}</Pill><Pill>Edition {c.agentVersion}</Pill><Pill>demo</Pill>{c.tags.map((tg) => <Pill key={tg} tone="rose">{tg}</Pill>)}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="quiet" onClick={() => setMasked(!masked)} aria-pressed={masked}><EyeOff size={15} /> {masked ? "Show details" : "Hide personal details"}</Button>
          <Button variant="quiet" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ call: c, transcript: turns }, null, 2)], { type: "application/json" })); a.download = `${c.id}.json`; a.click(); }}><Download size={15} /> Export</Button>
          <Button variant="quiet" aria-label="Delete conversation" onClick={() => confirm("Delete this conversation? In the preview this only hides it.") && setGone(true)}><Trash2 size={15} /></Button>
        </div>
      </div>
      <p className="mt-6 border-l-2 border-atl-champ pl-4 font-serif text-xl italic leading-snug text-atl-soft">{mask(c.summary)}</p>
      {appt && <p className="mt-4 text-sm">Booked: <span className="font-medium">{serviceById(appt.serviceId).name}</span> with {staffById(appt.staffId).name.split(" ")[0]}, {relativeDay(appt.date)} at {fmtTime(appt.startMin)} · <span className="text-atl-soft">{appt.status.replace("_", " ")}</span></p>}

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-atl-line py-5 text-sm sm:grid-cols-4">
        {facts.map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-[0.16em] text-atl-soft">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
      </dl>

      {gone ? <p className="mt-10 text-atl-soft">This conversation has been deleted. In the live product this is recorded in your activity log and the recording and transcript are removed.</p> : (
        <>
          <div className="mt-8 flex items-center gap-4">
            <button onClick={() => { if (t >= end) setT(0); setPlaying((p) => !p); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-atl-ink text-atl-paper" aria-label={playing ? "Pause replay" : "Replay conversation"}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <input type="range" min={0} max={end} step={0.5} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} className="flex-1 accent-[rgb(var(--atl-champdeep))]" aria-label="Position in conversation" />
            <span className="w-24 text-right text-xs text-atl-soft">{fmtDuration(Math.floor(t))} / {fmtDuration(end)}</span>
          </div>
          <p className="mt-2 text-xs italic text-atl-soft">Replay steps through the written record; no audio is kept for demo calls.</p>
          <ol className="mt-8 space-y-6">
            {turns.map((turn, i) => (
              <li key={i} className={clsx("grid grid-cols-[52px_minmax(0,1fr)] gap-4 transition", turn.at > t && "opacity-25")}>
                <span className="pt-1 text-xs text-atl-soft">{fmtDuration(turn.at)}</span>
                {turn.speaker === "tool" && turn.tool ? (
                  <div>
                    <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className={clsx("flex w-full items-center gap-2 text-left text-sm italic", turn.tool.ok ? "text-atl-champdeep" : "text-atl-rose")}>
                      <span>{agent} used <span className="not-italic font-medium">{turn.tool.name.replaceAll("_", " ")}</span> — {mask(turn.tool.result)}</span>
                      <ChevronDown size={14} className={clsx("ml-auto shrink-0 transition", open === i && "rotate-180")} />
                    </button>
                    {open === i && (
                      <dl className="mt-2 divide-y divide-atl-line rounded-2xl bg-atl-bg/70 px-4 text-xs ring-1 ring-atl-line">
                        {Object.entries(turn.tool.args).map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-1.5"><dt className="font-mono">{k}</dt><dd className="text-right text-atl-soft">{mask(String(v))}</dd></div>)}
                      </dl>
                    )}
                  </div>
                ) : turn.speaker === "system" ? <div className="text-xs uppercase tracking-[0.18em] text-atl-soft">{mask(turn.text)}</div>
                  : <div><div className="text-xs font-medium uppercase tracking-[0.18em] text-atl-soft">{turn.speaker === "agent" ? agent : "Caller"}{turn.interrupted && " · interrupted"}</div><p className={clsx("mt-1 text-lg leading-relaxed", turn.speaker === "agent" ? "font-serif text-xl" : "")}>{mask(turn.text)}</p></div>}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="mt-10 rounded-2xl bg-atl-bg/70 p-5 ring-1 ring-atl-line">
        <div className="text-xs uppercase tracking-[0.18em] text-atl-soft">Good-practice checks</div>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 text-atl-sage" />{agent} said it was an AI receptionist in the greeting</li>
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 text-atl-sage" />{recording ? "Recording was mentioned before anything was captured" : "Recording notice is currently switched off"}</li>
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 text-atl-sage" />Deleted automatically after {retention} days</li>
        </ul>
      </div>
      <div className="mt-6"><DemoNote>Synthetic transcript.</DemoNote></div>
    </Card>
  );
}
