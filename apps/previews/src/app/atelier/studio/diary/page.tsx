"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { BUSINESS, STAFF, serviceById, staffById } from "@/lib/demo-data";
import { useAllAppointments, usePreview } from "@/lib/store";
import { DEMO_TODAY, addDays, dayLong, dayNum, dow, fmtDateLong, fmtTime, monthGrid, monthLong, sameMonth } from "@/lib/time";

export default function Diary() {
  const appts = useAllAppointments();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const [month, setMonth] = useState(DEMO_TODAY);
  const [day, setDay] = useState(DEMO_TODAY);
  const [staff, setStaff] = useState<string>("all");
  const grid = monthGrid(month);
  const live = appts.filter((a) => a.status !== "cancelled" && (staff === "all" || a.staffId === staff));
  const list = live.filter((a) => a.date === day).sort((a, b) => a.startMin - b.startMin);
  const shiftMonth = (n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 10)); };
  const mtd = appts.filter((a) => sameMonth(a.date, month));
  const byVoice = mtd.filter((a) => a.bookedVia === "voice_agent").length;
  const noShows = mtd.filter((a) => a.status === "no_show").length;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Diary</Eyebrow><Title className="mt-4">{monthLong(month)}</Title></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setStaff("all")} className={clsx("rounded-full px-4 py-2 text-sm ring-1", staff === "all" ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>Whole team</button>
          {STAFF.map((s) => <button key={s.id} onClick={() => setStaff(s.id)} className={clsx("rounded-full px-4 py-2 text-sm ring-1", staff === s.id ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>{s.name.split(" ")[0]}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5 sm:p-8">
          <div className="mb-4 flex items-center justify-between">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-full p-2 hover:bg-atl-bg"><ChevronLeft size={18} /></button>
            <span className="font-serif text-xl">{monthLong(month)} {month.slice(0, 4)}</span>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-full p-2 hover:bg-atl-bg"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-[0.18em] text-atl-soft">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d.slice(0, 2)}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((d) => {
              const n = live.filter((a) => a.date === d).length;
              const v = live.filter((a) => a.date === d && a.bookedVia === "voice_agent").length;
              const closed = !BUSINESS.hours[dow(d)];
              return (
                <button key={d} onClick={() => setDay(d)} aria-label={`${fmtDateLong(d)}: ${n} appointments`} aria-pressed={d === day}
                  className={clsx("flex aspect-square flex-col items-center justify-center rounded-2xl text-sm transition", !sameMonth(d, month) && "opacity-30", d === day ? "bg-atl-ink text-atl-paper" : "hover:bg-atl-bg", d === DEMO_TODAY && d !== day && "ring-1 ring-atl-champ")}>
                  <span className="font-serif text-lg">{dayNum(d)}</span>
                  {closed ? <span className="text-[9px] opacity-60">closed</span> : (
                    <span className="mt-0.5 flex gap-0.5">{Array.from({ length: Math.min(4, Math.ceil(n / 4)) }, (_, i) => <span key={i} className={clsx("h-1 w-1 rounded-full", i < Math.ceil(v / 2) ? "bg-atl-champ" : d === day ? "bg-atl-paper/60" : "bg-atl-soft/40")} />)}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-atl-soft"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-atl-champ" /> includes bookings by {agent}</span><span>{byVoice} of {mtd.length} this month booked by phone · {noShows} no-shows</span></div>
        </Card>
        <div>
          <H2>{dayLong(day)} {dayNum(day)}</H2>
          <p className="mt-1 text-sm text-atl-soft">{list.length ? `${list.length} appointments` : BUSINESS.hours[dow(day)] ? "Nothing booked yet" : `Closed — ${agent} still takes calls and books ahead.`}</p>
          <ol className="mt-6 space-y-3">
            {list.map((a) => (
              <li key={a.id}><Card as="div" className="flex items-center gap-4 p-4">
                <div className="w-16 text-center"><div className="font-serif text-2xl">{fmtTime(a.startMin)}</div><div className="text-[11px] text-atl-soft">{a.durationMin} min</div></div>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.customerName}</div><div className="truncate text-sm text-atl-soft">{serviceById(a.serviceId).name} · {staffById(a.staffId).name}</div></div>
                <div className="flex flex-col items-end gap-1">{a.bookedVia === "voice_agent" && <Pill tone="champ">by {agent}</Pill>}{a.status === "no_show" && <Pill tone="rose">no-show</Pill>}{a.status === "completed" && <Pill>done</Pill>}</div>
              </Card></li>
            ))}
          </ol>
          <div className="mt-6 flex gap-2">
            <button onClick={() => setDay(addDays(day, -1))} className="rounded-full px-4 py-2 text-sm ring-1 ring-atl-line">← Previous day</button>
            <button onClick={() => setDay(addDays(day, 1))} className="rounded-full px-4 py-2 text-sm ring-1 ring-atl-line">Next day →</button>
          </div>
          <div className="mt-6"><DemoNote>Demo diary. Bookings you make in the Rehearsal room appear here too.</DemoNote></div>
        </div>
      </div>
    </div>
  );
}
