"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Chip, FBtn, Glass, GHead, Heading } from "@/components/flow/ui";
import { BUSINESS, STAFF, serviceById, staffById } from "@/lib/demo-data";
import { useAllAppointments } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dayNum, dayShort, dow, fmtTime, weekDays } from "@/lib/time";
import type { Appointment } from "@/lib/types";

const START = 8 * 60, END = 20 * 60, PX = 0.9;
const STAFF_COLOR = ["167 139 250", "103 232 249", "244 114 182", "190 242 100"];

export default function Calendar() {
  const appts = useAllAppointments();
  const [anchor, setAnchor] = useState(DEMO_TODAY);
  const [sel, setSel] = useState<Appointment | null>(null);
  const [onlyVoice, setOnlyVoice] = useState(false);
  const days = weekDays(anchor);
  const shown = appts.filter((a) => a.status !== "cancelled" && (!onlyVoice || a.bookedVia === "voice_agent"));
  const color = (id: string) => STAFF_COLOR[STAFF.findIndex((s) => s.id === id) % 4];
  return (
    <>
      <Heading kicker="Calendar" title={`Week of ${dayNum(days[0])} ${days[0].slice(5, 7) === "10" ? "October" : "November"}`}>
        <FBtn onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Previous week"><ChevronLeft size={14} /></FBtn>
        <FBtn onClick={() => setAnchor(DEMO_TODAY)}>This week</FBtn>
        <FBtn onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Next week"><ChevronRight size={14} /></FBtn>
        <FBtn onClick={() => setOnlyVoice(!onlyVoice)} aria-pressed={onlyVoice} className={onlyVoice ? "border-flw-violet text-flw-violet" : ""}>AI-booked only</FBtn>
      </Heading>
      <div className="mb-3 flex flex-wrap gap-3 text-xs">{STAFF.map((s, i) => <span key={s.id} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: `rgb(${STAFF_COLOR[i]})` }} />{s.name}</span>)}<Chip tone="amber">demo diary</Chip></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <Glass className="overflow-x-auto">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))" }}>
            <div />
            {days.map((d) => <div key={d} className={clsx("border-b border-l border-flw-line/60 px-2 py-2 text-center text-xs", d === DEMO_TODAY ? "text-flw-cyan" : "text-flw-mute")}><div>{dayShort(d)}</div><div className="font-display text-lg text-flw-text">{dayNum(d)}</div></div>)}
            <div className="relative" style={{ height: (END - START) * PX }}>
              {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute right-1 -translate-y-1/2 font-mono text-[9px] text-flw-mute" style={{ top: i * 60 * PX }}>{fmtTime(START + i * 60)}</div>)}
            </div>
            {days.map((d) => {
              const open = BUSINESS.hours[dow(d)];
              return (
                <div key={d} className="relative border-l border-flw-line/60" style={{ height: (END - START) * PX }}>
                  {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-flw-line/30" style={{ top: i * 60 * PX }} />)}
                  {!open && <div className="absolute inset-0 grid place-items-center bg-flw-bg/50 font-mono text-[10px] uppercase tracking-widest text-flw-mute">closed</div>}
                  {shown.filter((a) => a.date === d).map((a) => {
                    const c = color(a.staffId);
                    return (
                      <button key={a.id} onClick={() => setSel(a)} title={`${a.customerName} · ${serviceById(a.serviceId).name}`}
                        className="absolute overflow-hidden rounded-lg border px-1 py-0.5 text-left text-[10px] leading-tight transition hover:z-10"
                        style={{ top: (a.startMin - START) * PX, height: Math.max(14, a.durationMin * PX - 2), left: `${(STAFF.findIndex((s) => s.id === a.staffId) * 25)}%`, width: "24%", borderColor: `rgb(${c} / .6)`, background: `rgb(${c} / ${a.bookedVia === "voice_agent" ? 0.32 : 0.12})`, boxShadow: a.bookedVia === "voice_agent" ? `0 0 14px -4px rgb(${c})` : undefined }}>
                        <span className="truncate">{fmtTime(a.startMin)}</span>
                      </button>
                    );
                  })}
                  {d === DEMO_TODAY && <div className="absolute inset-x-0 border-t-2 border-flw-cyan" style={{ top: (DEMO_NOW_MIN - START) * PX }} />}
                </div>
              );
            })}
          </div>
        </Glass>
        <Glass>
          <GHead title="Appointment" />
          <div className="p-4 text-sm">
            {sel ? (
              <div className="space-y-2">
                <div className="font-display text-xl">{sel.customerName}</div>
                <div className="text-flw-mute">{serviceById(sel.serviceId).name} · {sel.durationMin} min</div>
                <div className="text-flw-mute">{dayShort(sel.date)} {dayNum(sel.date)} · {fmtTime(sel.startMin)}–{fmtTime(sel.startMin + sel.durationMin)} · {staffById(sel.staffId).name}</div>
                <div className="flex gap-2 pt-1"><Chip tone={sel.bookedVia === "voice_agent" ? "violet" : "mute"}>{sel.bookedVia === "voice_agent" ? "AI receptionist" : sel.bookedVia.replace("_", " ")}</Chip><Chip tone={sel.status === "no_show" ? "pink" : "cyan"}>{sel.status.replace("_", " ")}</Chip></div>
                {sel.callId && <a className="block pt-2 text-flw-cyan" href={`/flow/app/calls/${sel.callId}`}>View source call trace →</a>}
              </div>
            ) : <p className="text-flw-mute">Select a block. Glowing blocks were booked by the AI receptionist.</p>}
          </div>
        </Glass>
      </div>
    </>
  );
}
