"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Btn, PageHead, Panel, Stat, Tag } from "@/components/command/ui";
import { BUSINESS, STAFF, serviceById } from "@/lib/demo-data";
import { useAllAppointments } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dayNum, dayShort, dow, fmtDate, fmtTime, startOfWeek } from "@/lib/time";
import type { Appointment } from "@/lib/types";

const START = 8 * 60, END = 20 * 60, PX = 1.1; // px per minute

export default function Appointments() {
  const all = useAllAppointments();
  const [day, setDay] = useState(DEMO_TODAY);
  const [sel, setSel] = useState<Appointment | null>(null);
  const dayAppts = all.filter((a) => a.date === day && a.status !== "cancelled");

  const last28 = useMemo(() => all.filter((a) => a.date > addDays(DEMO_TODAY, -28) && a.date <= DEMO_TODAY), [all]);
  const voice = last28.filter((a) => a.bookedVia === "voice_agent");
  const noShow = last28.filter((a) => a.status === "no_show").length;
  const past = last28.filter((a) => a.status === "completed" || a.status === "no_show").length;
  const weekStart = startOfWeek(day);
  const byDay = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const xs = all.filter((a) => a.date === d && a.status !== "cancelled");
    return { name: `${dayShort(d)} ${dayNum(d)}`, voice: xs.filter((a) => a.bookedVia === "voice_agent").length, other: xs.filter((a) => a.bookedVia !== "voice_agent").length };
  });
  const open = BUSINESS.hours[dow(day)];

  return (
    <>
      <PageHead kicker="Operate · scheduling" title="Appointments">
        <Tag tone="warn">Demo diary · bookings from the simulator appear here</Tag>
      </PageHead>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Booked by AI · 28d" value={voice.length} tone="violet" sub={`${((voice.length / Math.max(1, last28.length)) * 100).toFixed(0)}% of all bookings`} />
        <Stat label="No-show rate · 28d" value={`${((noShow / Math.max(1, past)) * 100).toFixed(1)}%`} sub={`${noShow} of ${past} past appointments`} tone={noShow / Math.max(1, past) > 0.06 ? "warn" : "text"} />
        <Stat label="Today" value={all.filter((a) => a.date === DEMO_TODAY && a.status !== "cancelled").length} sub="appointments" />
        <Stat label="Upcoming 7d" value={all.filter((a) => a.date > DEMO_TODAY && a.date <= addDays(DEMO_TODAY, 7) && a.status === "confirmed").length} tone="cyan" sub="confirmed" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <Panel dense title={<span>{fmtDate(day)} · staff lanes</span>} action={
          <div className="flex items-center gap-1">
            <Btn onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft size={14} /></Btn>
            <Btn onClick={() => setDay(DEMO_TODAY)}>Today</Btn>
            <Btn onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight size={14} /></Btn>
          </div>}>
          {!open ? (
            <div className="p-10 text-center text-sm text-cmd-mute">Studio closed on {dayShort(day)}s. The AI receptionist still answers, takes messages and books future slots.</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="relative min-w-[680px]" style={{ height: (END - START) * PX + 40 }}>
                <div className="absolute inset-y-0 left-0 w-14 border-r border-cmd-line">
                  {Array.from({ length: (END - START) / 60 + 1 }, (_, i) => (
                    <div key={i} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-cmd-mute" style={{ top: 32 + i * 60 * PX }}>{fmtTime(START + i * 60)}</div>
                  ))}
                </div>
                <div className="absolute inset-y-0 left-14 right-0 grid" style={{ gridTemplateColumns: `repeat(${STAFF.length}, minmax(0, 1fr))` }}>
                  {STAFF.map((s) => {
                    const h = s.hours[dow(day)];
                    return (
                      <div key={s.id} className="relative border-r border-cmd-line">
                        <div className="sticky top-0 flex h-8 items-center gap-2 border-b border-cmd-line px-2 text-xs"><span className="grid h-5 w-5 place-items-center rounded bg-cmd-raised font-mono text-[9px]">{s.initials}</span><span className="truncate">{s.name.split(" ")[0]}</span></div>
                        {Array.from({ length: (END - START) / 60 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-cmd-line/50" style={{ top: 32 + i * 60 * PX }} />)}
                        {!h && <div className="absolute inset-x-0 bottom-0 top-8 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgb(42_42_52/.5)_6px,rgb(42_42_52/.5)_7px)]" title="Not working" />}
                        {h && <>
                          <div className="absolute inset-x-0 top-8 bg-cmd-bg/60" style={{ height: Math.max(0, (h[0] - START) * PX) }} />
                          <div className="absolute inset-x-0 bottom-0 bg-cmd-bg/60" style={{ top: 32 + (h[1] - START) * PX }} />
                        </>}
                        {dayAppts.filter((a) => a.staffId === s.id).map((a) => (
                          <button key={a.id} onClick={() => setSel(a)}
                            className={clsx("absolute inset-x-1 flex flex-col justify-start overflow-hidden rounded border px-1.5 py-1 text-left text-[11px] transition hover:z-10 hover:brightness-125",
                              a.bookedVia === "voice_agent" ? "border-cmd-violet/60 bg-cmd-violet/20" : "border-cmd-line bg-cmd-raised",
                              a.status === "no_show" && "border-cmd-bad/60 bg-cmd-bad/10", sel?.id === a.id && "ring-1 ring-cmd-cyan")}
                            style={{ top: 32 + (a.startMin - START) * PX, height: a.durationMin * PX - 2 }}>
                            <div className="truncate font-medium">{a.customerName}</div>
                            <div className="truncate font-mono text-[10px] text-cmd-mute">{fmtTime(a.startMin)} · {serviceById(a.serviceId).name}</div>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {day === DEMO_TODAY && <div className="pointer-events-none absolute left-14 right-0 border-t border-cmd-cyan" style={{ top: 32 + (DEMO_NOW_MIN - START) * PX }}><span className="absolute -top-2 left-0 rounded bg-cmd-cyan px-1 font-mono text-[9px] text-black">{fmtTime(DEMO_NOW_MIN)}</span></div>}
              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Selected">
            {sel ? (
              <div className="space-y-1 text-sm">
                <div className="font-medium">{sel.customerName}</div>
                <div className="text-cmd-mute">{serviceById(sel.serviceId).name} · {sel.durationMin} min</div>
                <div className="text-cmd-mute">{fmtDate(sel.date)} {fmtTime(sel.startMin)} – {fmtTime(sel.startMin + sel.durationMin)}</div>
                <div className="flex gap-2 pt-2"><Tag tone={sel.bookedVia === "voice_agent" ? "violet" : "mute"}>{sel.bookedVia.replace("_", " ")}</Tag><Tag tone={sel.status === "no_show" ? "bad" : "ok"}>{sel.status.replace("_", " ")}</Tag></div>
                {sel.callId && <a href={`/command/calls/${sel.callId}`} className="block pt-2 text-cmd-violet hover:underline">Open source call →</a>}
              </div>
            ) : <p className="text-sm text-cmd-mute">Select an appointment block.</p>}
          </Panel>
          <Panel title="This week · by channel">
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={byDay} margin={{ left: -24 }}>
                  <XAxis dataKey="name" stroke="rgb(140 140 158)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgb(140 140 158)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "rgb(17 17 22)", border: "1px solid rgb(42 42 52)", fontSize: 12 }} cursor={{ fill: "rgb(26 26 33)" }} />
                  <Bar dataKey="voice" name="AI receptionist" stackId="a" fill="rgb(139 92 246)" />
                  <Bar dataKey="other" name="Front desk / online" stackId="a" fill="rgb(60 60 74)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Booking rules in force">
            <ul className="space-y-1 text-xs text-cmd-mute">
              <li>• Service durations + buffers enforced</li><li>• Staff skills & working hours respected</li><li>• Colour needs patch test ≥ 48h before</li><li>• Caller must confirm before booking</li><li>• Idempotency key per booking request</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
