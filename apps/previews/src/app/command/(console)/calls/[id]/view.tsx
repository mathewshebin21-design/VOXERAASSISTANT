"use client";

import { clsx } from "clsx";
import { ArrowLeft, ChevronDown, Download, EyeOff, Pause, Play, ShieldAlert, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Btn, Panel, PageHead, Tag } from "@/components/command/ui";
import { APPOINTMENTS, callById, serviceById, staffById, transcriptFor } from "@/lib/demo-data";
import { INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { fmtDate, fmtDuration, fmtTime, gbp } from "@/lib/time";

const redact = (s: string, names: string[]) => names.reduce((t, n) => t.replaceAll(n, "[name]"), s).replace(/\+44[\d\s•]+/g, "[number]");

export function TranscriptView({ id }: { id: string }) {
  const call = callById(id)!;
  const turns = useMemo(() => transcriptFor(call), [call]);
  const end = Math.max(call.durationSec, (turns.at(-1)?.at ?? 0) + 2);
  const [t, setT] = useState(end);
  const [playing, setPlaying] = useState(false);
  const [masked, setMasked] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const appt = call.appointmentId ? APPOINTMENTS.find((a) => a.id === call.appointmentId) : undefined;
  const names = [call.callerName, call.callerName.split(" ")[0]];

  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setT((x) => { if (x >= end) { setPlaying(false); return end; } return x + 0.5; }), 125);
    return () => clearInterval(i);
  }, [playing, end]);

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ call, transcript: turns }, null, 2)], { type: "application/json" }));
    a.download = `${call.id}.json`;
    a.click();
  };

  return (
    <>
      <Link href="/command/calls" className="mb-3 inline-flex items-center gap-1 text-sm text-cmd-mute hover:text-cmd-text"><ArrowLeft size={14} /> Calls</Link>
      <PageHead kicker={`Transcript · ${call.id}`} title={masked ? "[name]" : call.callerName}>
        <Btn onClick={() => setMasked((m) => !m)} aria-pressed={masked}><EyeOff size={14} /> {masked ? "Show PII" : "Redact PII"}</Btn>
        <Btn onClick={download}><Download size={14} /> JSON</Btn>
        <Btn variant="danger" onClick={() => { if (confirm("Delete this transcript? (Preview: only hides it in this browser session.)")) setDeleted(true); }}><Trash2 size={14} /> Delete</Btn>
      </PageHead>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Panel dense title="Conversation" action={<Tag tone="warn">demo transcript</Tag>}>
          {deleted ? (
            <div className="p-8 text-center text-sm text-cmd-mute">Transcript deleted. In production this writes an audit entry and purges the recording and transcript from storage.</div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-cmd-line px-4 py-3">
                <button onClick={() => { if (t >= end) setT(0); setPlaying((p) => !p); }} className="grid h-8 w-8 place-items-center rounded-full bg-cmd-violet text-white" aria-label={playing ? "Pause replay" : "Replay transcript"}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
                <input type="range" min={0} max={end} step={0.5} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} className="flex-1 accent-[rgb(var(--cmd-violet))]" aria-label="Transcript position" />
                <span className="w-24 text-right font-mono text-xs text-cmd-mute">{fmtDuration(Math.floor(t))} / {fmtDuration(end)}</span>
              </div>
              <p className="px-4 pt-2 font-mono text-[10px] text-cmd-mute">Replay steps through the text timeline. No audio is stored for demo calls.</p>
              <ol className="space-y-3 p-4">
                {turns.map((turn, i) => {
                  const future = turn.at > t;
                  const text = masked ? redact(turn.text, names) : turn.text;
                  return (
                    <li key={i} className={clsx("grid grid-cols-[44px_minmax(0,1fr)] gap-3 transition", future && "opacity-25")}>
                      <span className="pt-0.5 font-mono text-[11px] text-cmd-mute">{fmtDuration(turn.at)}</span>
                      {turn.speaker === "tool" && turn.tool ? (
                        <div className={clsx("rounded-md border px-3 py-2", turn.tool.ok ? "border-cmd-cyan/30 bg-cmd-cyan/5" : "border-cmd-bad/40 bg-cmd-bad/5")}>
                          <button className="flex w-full items-center gap-2 text-left font-mono text-xs" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                            <Wrench size={12} className={turn.tool.ok ? "text-cmd-cyan" : "text-cmd-bad"} />
                            <span className={turn.tool.ok ? "text-cmd-cyan" : "text-cmd-bad"}>{turn.tool.name}</span>
                            <span className="truncate text-cmd-mute">→ {turn.tool.result}</span>
                            <ChevronDown size={12} className={clsx("ml-auto shrink-0 transition", open === i && "rotate-180")} />
                          </button>
                          {open === i && <pre className="mt-2 overflow-x-auto rounded bg-cmd-bg p-2 font-mono text-[11px] text-cmd-mute">{JSON.stringify(masked ? JSON.parse(redact(JSON.stringify(turn.tool.args), names)) : turn.tool.args, null, 2)}</pre>}
                        </div>
                      ) : turn.speaker === "system" ? (
                        <div className="font-mono text-xs text-cmd-mute">— {text}</div>
                      ) : (
                        <div>
                          <div className={clsx("font-mono text-[10px] uppercase tracking-wider", turn.speaker === "agent" ? "text-cmd-violet" : "text-cmd-mute")}>{turn.speaker === "agent" ? "AI receptionist" : "Caller"}{turn.interrupted && <span className="ml-2 text-cmd-warn">interrupted</span>}</div>
                          <p className="mt-0.5 text-[15px] leading-relaxed">{text}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Call facts">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {[
                ["When", `${fmtDate(call.date)} ${fmtTime(call.timeMin)}`],
                ["Duration", fmtDuration(call.durationSec)],
                ["Number", masked ? "[number]" : call.callerNumberMasked],
                ["Agent", `v${call.agentVersion}`],
                ["Intent", INTENT_LABEL[call.intent]],
                ["Outcome", OUTCOME_LABEL[call.outcome]],
                ["Sentiment", call.sentiment],
                ["Latency p50", call.latencyMsP50 ? `${call.latencyMsP50} ms (sim)` : "—"],
                ["Cost", `${gbp(call.costGBP, 3)} (est.)`],
                ["Source", "Demo"],
              ].map(([k, v]) => (
                <div key={k} className="contents"><dt className="font-mono text-[10px] uppercase tracking-wider text-cmd-mute">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="AI summary"><p className="text-sm text-cmd-mute">{masked ? redact(call.summary, names) : call.summary}</p>{call.tags.map((tg) => <Tag key={tg} tone="warn">{tg}</Tag>)}</Panel>
          {appt && (
            <Panel title="Linked appointment">
              <div className="text-sm"><div className="font-medium">{serviceById(appt.serviceId).name}</div><div className="text-cmd-mute">{fmtDate(appt.date)} · {fmtTime(appt.startMin)} · {staffById(appt.staffId).name}</div><div className="mt-2"><Tag tone="violet">{appt.status}</Tag></div></div>
            </Panel>
          )}
          <Panel title="Compliance">
            <ul className="space-y-1.5 text-sm text-cmd-mute">
              <li className="flex gap-2"><ShieldAlert size={14} className="mt-0.5 text-cmd-ok" />AI identity disclosed in greeting</li>
              <li className="flex gap-2"><ShieldAlert size={14} className="mt-0.5 text-cmd-ok" />Recording notice played before capture</li>
              <li className="flex gap-2"><ShieldAlert size={14} className="mt-0.5 text-cmd-ok" />Retention: auto-delete after 90 days</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
