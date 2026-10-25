"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, FBtn, Glass, GHead, Heading } from "@/components/flow/ui";
import { BUSINESS, STAFF, serviceById, staffById } from "@/lib/demo-data";
import { useAllAppointments } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dayLong, dayNum, dayShort, dow, fmtTime, monthGrid, monthLong, sameMonth, weekDays } from "@/lib/time";
import type { Appointment } from "@/lib/types";

type View = "month" | "week" | "day";
const START = 8 * 60, END = 20 * 60;
const STAFF_COLOR = ["167 139 250", "103 232 249", "244 114 182", "190 242 100"];
const color = (id: string) => STAFF_COLOR[STAFF.findIndex((s) => s.id === id) % 4];

export default function Calendar() {
  const appts = useAllAppointments();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(DEMO_TODAY);
  const [sel, setSel] = useState<Appointment | null>(null);
  const [onlyVoice, setOnlyVoice] = useState(false);
  const [staff, setStaff] = useState("all");
  const days = weekDays(anchor);
  const shown = appts.filter((a) => a.status !== "cancelled" && (!onlyVoice || a.bookedVia === "voice_agent") && (staff === "all" || a.staffId === staff));
  const step = (n: number) => {
    if (view === "month") { const [y, m] = anchor.split("-").map(Number); setAnchor(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)); }
    else setAnchor(addDays(anchor, view === "week" ? 7 * n : n));
  };
  const last28 = useMemo(() => appts.filter((a) => a.date > addDays(DEMO_TODAY, -28) && a.date <= DEMO_TODAY), [appts]);
  const voice28 = last28.filter((a) => a.bookedVia === "voice_agent").length;
  const past = last28.filter((a) => a.status === "completed" || a.status === "no_show");
  const noShow = past.filter((a) => a.status === "no_show").length;
  const channel = days.map((d) => { const xs = appts.filter((a) => a.date === d && a.status !== "cancelled"); return { name: `${dayShort(d)} ${dayNum(d)}`, ai: xs.filter((a) => a.bookedVia === "voice_agent").length, other: xs.filter((a) => a.bookedVia !== "voice_agent").length }; });

  const Block = ({ a, style, label }: { a: Appointment; style: React.CSSProperties; label: string }) => {
    const c = color(a.staffId);
    return (
      <button onClick={() => setSel(a)} title={`${a.customerName} · ${serviceById(a.serviceId).name}`}
        className={clsx("absolute flex flex-col justify-start overflow-hidden rounded-lg border px-1 py-0.5 text-left text-[10px] leading-tight transition hover:z-10", sel?.id === a.id && "ring-2 ring-flw-text")}
        style={{ ...style, borderColor: `rgb(${c} / .6)`, background: `rgb(${c} / ${a.bookedVia === "voice_agent" ? 0.32 : 0.12})`, boxShadow: a.bookedVia === "voice_agent" ? `0 0 14px -4px rgb(${c})` : undefined }}>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  const title = view === "month" ? `${monthLong(anchor)} ${anchor.slice(0, 4)}` : view === "week" ? `Week of ${dayNum(days[0])} ${monthLong(days[0])}` : `${dayLong(anchor)} ${dayNum(anchor)} ${monthLong(anchor)}`;

  return (
    <>
      <Heading kicker="Calendar" title={title}>
        {(["month", "week", "day"] as const).map((v) => <FBtn key={v} onClick={() => setView(v)} aria-pressed={view === v} className={view === v ? "border-flw-violet text-flw-violet" : ""}>{{ month: "Month", week: "Week", day: "Day by stylist" }[v]}</FBtn>)}
        <FBtn onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={14} /></FBtn>
        <FBtn onClick={() => setAnchor(DEMO_TODAY)}>Today</FBtn>
        <FBtn onClick={() => step(1)} aria-label="Next"><ChevronRight size={14} /></FBtn>
      </Heading>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["AI-booked · 28d", String(voice28), `${((voice28 / Math.max(1, last28.length)) * 100).toFixed(0)}% of bookings`], ["No-show rate · 28d", `${((noShow / Math.max(1, past.length)) * 100).toFixed(1)}%`, `${noShow} of ${past.length}`], ["Today", String(appts.filter((a) => a.date === DEMO_TODAY && a.status !== "cancelled").length), "appointments"], ["Next 7 days", String(appts.filter((a) => a.date > DEMO_TODAY && a.date <= addDays(DEMO_TODAY, 7) && a.status === "confirmed").length), "confirmed"]].map(([k, v, s]) => (
          <Glass key={k} className="p-4"><div className="text-xs text-flw-mute">{k}</div><div className="mt-1 font-display text-3xl font-semibold">{v}</div><div className="text-xs text-flw-mute">{s}</div></Glass>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => setStaff("all")} className={clsx("rounded-full px-3 py-1", staff === "all" ? "bg-flw-violet/25 text-flw-violet" : "text-flw-mute ring-1 ring-flw-line")}>Whole team</button>
        {STAFF.map((s, i) => <button key={s.id} onClick={() => setStaff(s.id)} className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1", staff === s.id ? "bg-flw-violet/25 text-flw-text" : "text-flw-mute ring-1 ring-flw-line")}><span className="h-2 w-2 rounded-full" style={{ background: `rgb(${STAFF_COLOR[i]})` }} />{s.name}</button>)}
        <button onClick={() => setOnlyVoice(!onlyVoice)} aria-pressed={onlyVoice} className={clsx("rounded-full px-3 py-1", onlyVoice ? "bg-flw-cyan/20 text-flw-cyan" : "text-flw-mute ring-1 ring-flw-line")}>AI-booked only</button>
        <Chip tone="amber">demo diary</Chip>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <Glass className="overflow-x-auto">
          {view === "month" && (
            <div className="p-4">
              <div className="grid grid-cols-7 text-center font-mono text-[10px] uppercase text-flw-mute">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid(anchor).map((d) => {
                  const n = shown.filter((a) => a.date === d).length;
                  const v = shown.filter((a) => a.date === d && a.bookedVia === "voice_agent").length;
                  return (
                    <button key={d} onClick={() => { setAnchor(d); setView("day"); }} aria-label={`${d}: ${n} appointments`} className={clsx("flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition hover:border-flw-violet/60", d === DEMO_TODAY ? "border-flw-cyan" : "border-flw-line/60", !sameMonth(d, anchor) && "opacity-30")}>
                      <span className="font-display text-lg">{dayNum(d)}</span>
                      {BUSINESS.hours[dow(d)] ? <span className="font-mono text-[9px] text-flw-mute">{n}{v ? <span className="text-flw-violet"> · {v} AI</span> : ""}</span> : <span className="font-mono text-[9px] text-flw-mute">closed</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {view === "week" && (
            <div className="grid min-w-[760px]" style={{ gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))" }}>
              <div />
              {days.map((d) => <button key={d} onClick={() => { setAnchor(d); setView("day"); }} className={clsx("border-b border-l border-flw-line/60 px-2 py-2 text-center text-xs", d === DEMO_TODAY ? "text-flw-cyan" : "text-flw-mute")}><div>{dayShort(d)}</div><div className="font-display text-lg text-flw-text">{dayNum(d)}</div></button>)}
              <div className="relative" style={{ height: (END - START) * 0.9 }}>{Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute right-1 -translate-y-1/2 font-mono text-[9px] text-flw-mute" style={{ top: i * 60 * 0.9 }}>{fmtTime(START + i * 60)}</div>)}</div>
              {days.map((d) => (
                <div key={d} className="relative border-l border-flw-line/60" style={{ height: (END - START) * 0.9 }}>
                  {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-flw-line/30" style={{ top: i * 60 * 0.9 }} />)}
                  {!BUSINESS.hours[dow(d)] && <div className="absolute inset-0 grid place-items-center bg-flw-bg/50 font-mono text-[10px] uppercase tracking-widest text-flw-mute">closed</div>}
                  {shown.filter((a) => a.date === d).map((a) => <Block key={a.id} a={a} label={fmtTime(a.startMin)} style={{ top: (a.startMin - START) * 0.9, height: Math.max(14, a.durationMin * 0.9 - 2), left: `${STAFF.findIndex((s) => s.id === a.staffId) * 25}%`, width: "24%" }} />)}
                  {d === DEMO_TODAY && <div className="absolute inset-x-0 border-t-2 border-flw-cyan" style={{ top: (DEMO_NOW_MIN - START) * 0.9 }} />}
                </div>
              ))}
            </div>
          )}
          {view === "day" && (!BUSINESS.hours[dow(anchor)] ? <p className="p-10 text-center text-sm text-flw-mute">Closed on {dayLong(anchor)}s — the agent still answers and books ahead.</p> : (
            <div className="relative min-w-[680px]" style={{ height: (END - START) * 1.1 + 40 }}>
              <div className="absolute inset-y-0 left-0 w-12">{Array.from({ length: 13 }, (_, i) => <div key={i} className="absolute right-2 -translate-y-1/2 font-mono text-[9px] text-flw-mute" style={{ top: 40 + i * 60 * 1.1 }}>{fmtTime(START + i * 60)}</div>)}</div>
              <div className="absolute inset-y-0 left-12 right-0 grid" style={{ gridTemplateColumns: `repeat(${STAFF.length}, minmax(0, 1fr))` }}>
                {STAFF.map((s, si) => {
                  const h = s.hours[dow(anchor)];
                  return (
                    <div key={s.id} className="relative border-l border-flw-line/60">
                      <div className="flex h-10 items-center gap-2 border-b border-flw-line/60 px-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: `rgb(${STAFF_COLOR[si]})` }} />{s.name.split(" ")[0]}</div>
                      {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-flw-line/30" style={{ top: 40 + i * 60 * 1.1 }} />)}
                      {!h ? <div className="absolute inset-x-0 bottom-0 top-10 grid place-items-center bg-flw-bg/50 font-mono text-[10px] text-flw-mute">off today</div> : <>
                        <div className="absolute inset-x-0 top-10 bg-flw-bg/50" style={{ height: Math.max(0, (h[0] - START) * 1.1) }} />
                        <div className="absolute inset-x-0 bottom-0 bg-flw-bg/50" style={{ top: 40 + (h[1] - START) * 1.1 }} />
                      </>}
                      {shown.filter((a) => a.date === anchor && a.staffId === s.id).map((a) => <Block key={a.id} a={a} label={`${fmtTime(a.startMin)} ${a.customerName} · ${serviceById(a.serviceId).name}`} style={{ top: 40 + (a.startMin - START) * 1.1, height: a.durationMin * 1.1 - 2, left: 4, right: 4 }} />)}
                    </div>
                  );
                })}
              </div>
              {anchor === DEMO_TODAY && <div className="pointer-events-none absolute left-12 right-0 border-t-2 border-flw-cyan" style={{ top: 40 + (DEMO_NOW_MIN - START) * 1.1 }} />}
            </div>
          ))}
        </Glass>
        <div className="space-y-4">
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
          <Glass>
            <GHead title="This week by channel" />
            <div className="h-44 p-3"><ResponsiveContainer>
              <BarChart data={channel} margin={{ left: -24 }}>
                <XAxis dataKey="name" stroke="rgb(150 146 180)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgb(150 146 180)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "rgb(22 20 38)", border: "1px solid rgb(44 40 70)", borderRadius: 12, fontSize: 12 }} cursor={{ fill: "rgb(44 40 70 / .4)" }} />
                <Bar dataKey="ai" name="AI receptionist" stackId="a" fill="rgb(167 139 250)" />
                <Bar dataKey="other" name="Front desk / online" stackId="a" fill="rgb(68 62 104)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          </Glass>
          <Glass>
            <GHead title="Booking rules in force" />
            <ul className="space-y-1 p-4 text-xs text-flw-mute"><li>· Service durations + buffers enforced</li><li>· Staff skills & working hours respected</li><li>· Colour needs patch test ≥ 48h before</li><li>· Caller must confirm before booking</li><li>· Idempotency key per booking request</li></ul>
          </Glass>
        </div>
      </div>
    </>
  );
}
