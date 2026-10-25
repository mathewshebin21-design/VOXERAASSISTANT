"use client";

import { clsx } from "clsx";
import { Download, EyeOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, DemoNote, Eyebrow, Pill, Title } from "./ui";
import { APPOINTMENTS, CALLS, callById, serviceById, transcriptFor } from "@/lib/demo-data";
import { INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { fmtDuration, fmtTime, relativeDay } from "@/lib/time";
import type { CallOutcome } from "@/lib/types";

const FILTERS: [string, CallOutcome | ""][] = [["Everything", ""], ["Booked", "booked"], ["Questions", "answered_question"], ["Handed over", "transferred"], ["Messages", "message_taken"], ["Unfinished", "failed"], ["Missed", "no_answer"]];

export function Journal({ selectedId }: { selectedId?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const outcome = (sp.get("outcome") ?? "") as CallOutcome | "";
  const [limit, setLimit] = useState(30);
  const rows = useMemo(() => CALLS.filter((c) => !outcome || c.outcome === outcome), [outcome]);
  const sel = selectedId ? callById(selectedId) : undefined;

  // Group by day for an editorial, journal-like list.
  const groups = useMemo(() => {
    const g = new Map<string, typeof rows>();
    for (const c of rows.slice(0, limit)) g.set(c.date, [...(g.get(c.date) ?? []), c]);
    return [...g.entries()];
  }, [rows, limit]);

  return (
    <div className="space-y-8">
      <div><Eyebrow>Journal</Eyebrow><Title className="mt-4">Every conversation, written down.</Title></div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {FILTERS.map(([l, k]) => (
          <button key={l} onClick={() => router.replace(`/atelier/studio/calls${k ? `?outcome=${k}` : ""}`)} className={clsx("whitespace-nowrap rounded-full px-4 py-2 text-sm ring-1", outcome === k ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line hover:ring-atl-champ")}>{l}</button>
        ))}
      </div>
      <p className="text-sm text-atl-soft">{rows.length} conversations{outcome ? " — the records behind this figure" : ""}. Demo records only.</p>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
        <div className={clsx(sel && "hidden lg:block")}>
          {groups.map(([day, cs]) => (
            <section key={day} className="mb-6">
              <div className="mb-2 font-serif text-lg italic text-atl-champdeep">{relativeDay(day)}</div>
              <ul className="divide-y divide-atl-line border-y border-atl-line">
                {cs.map((c) => (
                  <li key={c.id}>
                    <Link href={`/atelier/studio/calls/${c.id}${outcome ? `?outcome=${outcome}` : ""}`} className={clsx("flex items-start gap-3 px-2 py-3 transition", sel?.id === c.id ? "bg-atl-paper" : "hover:bg-atl-paper/60")}>
                      <span className="w-12 pt-0.5 text-sm text-atl-soft">{fmtTime(c.timeMin)}</span>
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{c.callerName}</span></div><div className="line-clamp-1 text-sm text-atl-soft">{c.summary}</div></div>
                      <Pill tone={c.outcome === "booked" ? "champ" : c.outcome === "failed" || c.outcome === "no_answer" ? "rose" : "plain"}>{OUTCOME_LABEL[c.outcome]}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {limit < rows.length && <Button variant="outline" onClick={() => setLimit((l) => l + 30)}>Show earlier</Button>}
        </div>
        <div>
          {sel ? <Reading id={sel.id} agent={agent} back={`/atelier/studio/calls${outcome ? `?outcome=${outcome}` : ""}`} /> : (
            <Card className="hidden h-full min-h-[300px] place-items-center p-10 text-center lg:grid"><div><div className="font-serif text-2xl">Choose a conversation</div><p className="mt-2 text-sm text-atl-soft">Its transcript opens here.</p></div></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Reading({ id, agent, back }: { id: string; agent: string; back: string }) {
  const c = callById(id)!;
  const turns = transcriptFor(c);
  const [masked, setMasked] = useState(false);
  const [gone, setGone] = useState(false);
  const retention = usePreview((s) => s.draft.retentionDays);
  const appt = c.appointmentId ? APPOINTMENTS.find((a) => a.id === c.appointmentId) : undefined;
  const mask = (s: string) => (masked ? s.replaceAll(c.callerName, "the caller").replaceAll(c.callerName.split(" ")[0], "the caller").replace(/\+44[\d\s•]+/g, "[number]") : s);
  return (
    <Card as="article" className="p-6 sm:p-10">
      <Link href={back} className="text-sm text-atl-soft lg:hidden">← Journal</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-atl-soft">{relativeDay(c.date)} at {fmtTime(c.timeMin)} · {fmtDuration(c.durationSec)}</div>
          <h2 className="mt-1 font-serif text-4xl">{masked ? "A caller" : c.callerName}</h2>
          <div className="mt-3 flex flex-wrap gap-2"><Pill tone="champ">{INTENT_LABEL[c.intent]}</Pill><Pill>{OUTCOME_LABEL[c.outcome]}</Pill><Pill>Edition {c.agentVersion}</Pill><Pill>demo</Pill></div>
        </div>
        <div className="flex gap-1">
          <Button variant="quiet" onClick={() => setMasked(!masked)} aria-pressed={masked}><EyeOff size={15} /> {masked ? "Show details" : "Hide personal details"}</Button>
          <Button variant="quiet" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ call: c, transcript: turns }, null, 2)], { type: "application/json" })); a.download = `${c.id}.json`; a.click(); }}><Download size={15} /> Export</Button>
          <Button variant="quiet" onClick={() => confirm("Delete this conversation? In the preview this only hides it.") && setGone(true)}><Trash2 size={15} /></Button>
        </div>
      </div>
      <p className="mt-6 border-l-2 border-atl-champ pl-4 font-serif text-xl italic leading-snug text-atl-soft">{mask(c.summary)}</p>
      {appt && <p className="mt-4 text-sm">Booked: <span className="font-medium">{serviceById(appt.serviceId).name}</span>, {relativeDay(appt.date)} at {fmtTime(appt.startMin)}.</p>}
      {gone ? <p className="mt-10 text-atl-soft">This conversation has been deleted.</p> : (
        <ol className="mt-10 space-y-6">
          {turns.map((t, i) => (
            <li key={i} className="grid grid-cols-[52px_minmax(0,1fr)] gap-4">
              <span className="pt-1 text-xs text-atl-soft">{fmtDuration(t.at)}</span>
              {t.speaker === "tool" && t.tool ? <div className={clsx("text-sm italic", t.tool.ok ? "text-atl-champdeep" : "text-atl-rose")}>{agent} used <span className="not-italic font-medium">{t.tool.name.replaceAll("_", " ")}</span> — {mask(t.tool.result)}</div>
                : t.speaker === "system" ? <div className="text-xs uppercase tracking-[0.18em] text-atl-soft">{mask(t.text)}</div>
                : <div><div className="text-xs font-medium uppercase tracking-[0.18em] text-atl-soft">{t.speaker === "agent" ? agent : "Caller"}{t.interrupted && " · interrupted"}</div><p className={clsx("mt-1 text-lg leading-relaxed", t.speaker === "agent" ? "font-serif text-xl" : "")}>{mask(t.text)}</p></div>}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-10"><DemoNote>Synthetic transcript. Personal details in real transcripts are kept for {retention} days, then deleted.</DemoNote></div>
    </Card>
  );
}
