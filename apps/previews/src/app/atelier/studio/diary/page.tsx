"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { BUSINESS, STAFF, serviceById, staffById } from "@/lib/demo-data";
import { useAllAppointments, usePreview } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dayLong, dayNum, dayShort, dow, fmtDateLong, fmtTime, monthGrid, monthLong, sameMonth, weekDays } from "@/lib/time";
import type { Appointment } from "@/lib/types";

type View = "month" | "week" | "stylists";
const START = 8 * 60, END = 20 * 60;
const STAFF_TONE = ["rgb(150 118 70)", "rgb(120 140 112)", "rgb(176 104 92)", "rgb(112 106 97)"];

export default function Diary() {
  const appts = useAllAppointments();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState(DEMO_TODAY);
  const [day, setDay] = useState(DEMO_TODAY);
  const [staff, setStaff] = useState<string>("all");
  const [onlyAgent, setOnlyAgent] = useState(false);
  const [sel, setSel] = useState<Appointment | null>(null);
  const live = appts.filter((a) => a.status !== "cancelled" && (staff === "all" || a.staffId === staff) && (!onlyAgent || a.bookedVia === "voice_agent"));
  const list = live.filter((a) => a.date === day).sort((a, b) => a.startMin - b.startMin);
  const shiftMonth = (n: number) => { const [y, m] = month.split("-").map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)); };
  const step = (n: number) => { if (view === "month") shiftMonth(n); else { const d = addDays(day, view === "week" ? 7 * n : n); setDay(d); setMonth(d); } };

  const last28 = useMemo(() => appts.filter((a) => a.date > addDays(DEMO_TODAY, -28) && a.date <= DEMO_TODAY), [appts]);
  const byAgent = last28.filter((a) => a.bookedVia === "voice_agent").length;
  const past = last28.filter((a) => a.status === "completed" || a.status === "no_show");
  const noShows = past.filter((a) => a.status === "no_show").length;
  const week = weekDays(day);
  const channel = week.map((d) => {
    const xs = appts.filter((a) => a.date === d && a.status !== "cancelled");
    return { name: `${dayShort(d)} ${dayNum(d)}`, phone: xs.filter((a) => a.bookedVia === "voice_agent").length, other: xs.filter((a) => a.bookedVia !== "voice_agent").length };
  });

  const Block = ({ a, style, compact }: { a: Appointment; style: React.CSSProperties; compact?: boolean }) => {
    const tone = STAFF_TONE[STAFF.findIndex((s) => s.id === a.staffId) % 4];
    return (
      <button onClick={() => setSel(a)} title={`${a.customerName} · ${serviceById(a.serviceId).name}`} style={{ ...style, borderColor: tone, background: a.bookedVia === "voice_agent" ? `${tone.replace("rgb", "rgba").replace(")", ", .22)")}` : "rgb(255 253 249)" }}
        className={clsx("absolute flex flex-col justify-start overflow-hidden rounded-xl border px-1.5 py-1 text-left text-[11px] leading-tight transition hover:z-10 hover:shadow-md", sel?.id === a.id && "ring-2 ring-atl-ink", a.status === "no_show" && "opacity-60")}>
        <div className="truncate font-medium">{compact ? fmtTime(a.startMin) : a.customerName}</div>
        {!compact && <div className="truncate text-atl-soft">{fmtTime(a.startMin)} · {serviceById(a.serviceId).name}</div>}
      </button>
    );
  };

  const heading = view === "month" ? `${monthLong(month)}` : view === "week" ? `Week of ${dayNum(week[0])} ${monthLong(week[0])}` : `${dayLong(day)} ${dayNum(day)}`;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Diary</Eyebrow><Title className="mt-4">{heading}</Title></div>
        <div className="flex flex-wrap items-center gap-2">
          {(["month", "week", "stylists"] as const).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={clsx("rounded-full px-4 py-2 text-sm ring-1", view === v ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>{{ month: "Month", week: "Week", stylists: "Day by stylist" }[v]}</button>)}
          <button onClick={() => setOnlyAgent(!onlyAgent)} aria-pressed={onlyAgent} className={clsx("rounded-full px-4 py-2 text-sm ring-1", onlyAgent ? "bg-atl-champ/20 text-atl-champdeep ring-atl-champ" : "ring-atl-line")}>Booked by {agent} only</button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-atl-line bg-atl-line md:grid-cols-4">
        {[["Booked by phone · 28 days", String(byAgent), `${((byAgent / Math.max(1, last28.length)) * 100).toFixed(0)}% of all bookings`],
          ["No-shows · 28 days", `${((noShows / Math.max(1, past.length)) * 100).toFixed(1)}%`, `${noShows} of ${past.length} past appointments`],
          ["Today", String(appts.filter((a) => a.date === DEMO_TODAY && a.status !== "cancelled").length), "appointments"],
          ["Next 7 days", String(appts.filter((a) => a.date > DEMO_TODAY && a.date <= addDays(DEMO_TODAY, 7) && a.status === "confirmed").length), "confirmed"]].map(([k, v, s]) => (
          <div key={k} className="bg-atl-paper p-6"><div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{k}</div><div className="mt-2 font-serif text-4xl">{v}</div><div className="mt-1 text-xs text-atl-soft">{s}</div></div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => step(-1)} aria-label="Previous" className="rounded-full p-2 ring-1 ring-atl-line hover:bg-atl-paper"><ChevronLeft size={16} /></button>
        <button onClick={() => { setDay(DEMO_TODAY); setMonth(DEMO_TODAY); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-atl-line">Today</button>
        <button onClick={() => step(1)} aria-label="Next" className="rounded-full p-2 ring-1 ring-atl-line hover:bg-atl-paper"><ChevronRight size={16} /></button>
        <span className="mx-2 h-5 w-px bg-atl-line" />
        <button onClick={() => setStaff("all")} className={clsx("rounded-full px-4 py-2 text-sm ring-1", staff === "all" ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>Whole team</button>
        {STAFF.map((s, i) => <button key={s.id} onClick={() => setStaff(s.id)} className={clsx("inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm ring-1", staff === s.id ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}><span className="h-2 w-2 rounded-full" style={{ background: STAFF_TONE[i] }} />{s.name.split(" ")[0]}</button>)}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.5fr_1fr]">
        {view === "month" && (
          <Card className="p-5 sm:p-8">
            <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-[0.18em] text-atl-soft">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d.slice(0, 2)}</div>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid(month).map((d) => {
                const n = live.filter((a) => a.date === d).length;
                const v = live.filter((a) => a.date === d && a.bookedVia === "voice_agent").length;
                const closed = !BUSINESS.hours[dow(d)];
                return (
                  <button key={d} onClick={() => setDay(d)} aria-label={`${fmtDateLong(d)}: ${n} appointments`} aria-pressed={d === day}
                    className={clsx("flex aspect-square flex-col items-center justify-center rounded-2xl text-sm transition", !sameMonth(d, month) && "opacity-30", d === day ? "bg-atl-ink text-atl-paper" : "hover:bg-atl-bg", d === DEMO_TODAY && d !== day && "ring-1 ring-atl-champ")}>
                    <span className="font-serif text-lg">{dayNum(d)}</span>
                    {closed ? <span className="text-[9px] opacity-60">closed</span> : <span className="mt-0.5 flex gap-0.5">{Array.from({ length: Math.min(4, Math.ceil(n / 4)) }, (_, i) => <span key={i} className={clsx("h-1 w-1 rounded-full", i < Math.ceil(v / 2) ? "bg-atl-champ" : d === day ? "bg-atl-paper/60" : "bg-atl-soft/40")} />)}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-5 flex items-center gap-1.5 text-xs text-atl-soft"><span className="h-1.5 w-1.5 rounded-full bg-atl-champ" /> includes bookings made by {agent}</p>
          </Card>
        )}

        {view === "week" && (
          <Card className="overflow-x-auto p-4">
            <div className="grid min-w-[720px]" style={{ gridTemplateColumns: "44px repeat(7, minmax(0, 1fr))" }}>
              <div />
              {week.map((d) => <button key={d} onClick={() => { setDay(d); setView("stylists"); }} className={clsx("border-b border-atl-line py-2 text-center text-xs", d === DEMO_TODAY ? "text-atl-champdeep" : "text-atl-soft")}>{dayShort(d)}<div className="font-serif text-xl text-atl-ink">{dayNum(d)}</div></button>)}
              <div className="relative" style={{ height: (END - START) * 0.85 }}>{Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute right-1 -translate-y-1/2 text-[10px] text-atl-soft" style={{ top: i * 60 * 0.85 }}>{fmtTime(START + i * 60)}</div>)}</div>
              {week.map((d) => (
                <div key={d} className="relative border-l border-atl-line" style={{ height: (END - START) * 0.85 }}>
                  {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-atl-line/50" style={{ top: i * 60 * 0.85 }} />)}
                  {!BUSINESS.hours[dow(d)] && <div className="absolute inset-0 grid place-items-center bg-atl-bg/70 text-[10px] uppercase tracking-[0.2em] text-atl-soft">closed</div>}
                  {live.filter((a) => a.date === d).map((a) => <Block key={a.id} a={a} compact style={{ top: (a.startMin - START) * 0.85, height: Math.max(16, a.durationMin * 0.85 - 2), left: `${STAFF.findIndex((s) => s.id === a.staffId) * 25}%`, width: "24%" }} />)}
                  {d === DEMO_TODAY && <div className="absolute inset-x-0 border-t-2 border-atl-rose" style={{ top: (DEMO_NOW_MIN - START) * 0.85 }} />}
                </div>
              ))}
            </div>
          </Card>
        )}

        {view === "stylists" && (
          <Card className="overflow-x-auto p-4">
            {!BUSINESS.hours[dow(day)] ? <p className="p-10 text-center text-atl-soft">Closed on {dayLong(day)}s — {agent} still answers and books ahead.</p> : (
              <div className="relative min-w-[640px]" style={{ height: (END - START) * 1.1 + 44 }}>
                <div className="absolute inset-y-0 left-0 w-12">{Array.from({ length: 13 }, (_, i) => <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-atl-soft" style={{ top: 44 + i * 60 * 1.1 }}>{fmtTime(START + i * 60)}</div>)}</div>
                <div className="absolute inset-y-0 left-12 right-0 grid" style={{ gridTemplateColumns: `repeat(${STAFF.length}, minmax(0, 1fr))` }}>
                  {STAFF.map((s, si) => {
                    const h = s.hours[dow(day)];
                    return (
                      <div key={s.id} className="relative border-l border-atl-line">
                        <div className="flex h-11 items-center gap-2 border-b border-atl-line px-2 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: STAFF_TONE[si] }} />{s.name.split(" ")[0]}</div>
                        {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-atl-line/50" style={{ top: 44 + i * 60 * 1.1 }} />)}
                        {!h ? <div className="absolute inset-x-0 bottom-0 top-11 grid place-items-center bg-atl-bg/70 text-xs italic text-atl-soft">not in today</div> : <>
                          <div className="absolute inset-x-0 top-11 bg-atl-bg/70" style={{ height: Math.max(0, (h[0] - START) * 1.1) }} />
                          <div className="absolute inset-x-0 bottom-0 bg-atl-bg/70" style={{ top: 44 + (h[1] - START) * 1.1 }} />
                        </>}
                        {live.filter((a) => a.date === day && a.staffId === s.id).map((a) => <Block key={a.id} a={a} style={{ top: 44 + (a.startMin - START) * 1.1, height: a.durationMin * 1.1 - 2, left: 4, right: 4 }} />)}
                      </div>
                    );
                  })}
                </div>
                {day === DEMO_TODAY && <div className="pointer-events-none absolute left-12 right-0 border-t-2 border-atl-rose" style={{ top: 44 + (DEMO_NOW_MIN - START) * 1.1 }} />}
              </div>
            )}
          </Card>
        )}

        <div className="space-y-6">
          <Card className="p-6">
            {sel ? (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-atl-soft">Selected appointment</div>
                <div className="font-serif text-3xl">{sel.customerName}</div>
                <div className="text-atl-soft">{serviceById(sel.serviceId).name} · {sel.durationMin} min · {staffById(sel.staffId).name}</div>
                <div className="text-atl-soft">{dayLong(sel.date)} {dayNum(sel.date)} · {fmtTime(sel.startMin)}–{fmtTime(sel.startMin + sel.durationMin)}</div>
                <div className="flex flex-wrap gap-2 pt-1"><Pill tone={sel.bookedVia === "voice_agent" ? "champ" : "plain"}>{sel.bookedVia === "voice_agent" ? `booked by ${agent}` : sel.bookedVia.replace("_", " ")}</Pill><Pill tone={sel.status === "no_show" ? "rose" : sel.status === "completed" ? "plain" : "sage"}>{sel.status.replace("_", " ")}</Pill></div>
                {sel.callId && <Link href={`/atelier/studio/calls/${sel.callId}`} className="inline-block pt-2 text-atl-champdeep underline-offset-4 hover:underline">Read the conversation that booked this →</Link>}
              </div>
            ) : (
              <>
                <H2>{dayLong(day)} {dayNum(day)}</H2>
                <p className="mt-1 text-sm text-atl-soft">{list.length ? `${list.length} appointments — select one for details` : BUSINESS.hours[dow(day)] ? "Nothing booked yet" : `Closed — ${agent} still takes calls and books ahead.`}</p>
                <ol className="mt-4 divide-y divide-atl-line">
                  {list.slice(0, 10).map((a) => (
                    <li key={a.id}><button onClick={() => setSel(a)} className="flex w-full items-center gap-3 py-2.5 text-left hover:text-atl-champdeep">
                      <span className="w-12 font-serif text-lg">{fmtTime(a.startMin)}</span><span className="min-w-0 flex-1 truncate">{a.customerName} <span className="text-atl-soft">· {serviceById(a.serviceId).name}</span></span>
                      {a.bookedVia === "voice_agent" && <Pill tone="champ">phone</Pill>}{a.status === "no_show" && <Pill tone="rose">no-show</Pill>}
                    </button></li>
                  ))}
                </ol>
              </>
            )}
            {sel && <button onClick={() => setSel(null)} className="mt-4 text-sm text-atl-soft hover:text-atl-ink">← Back to the day</button>}
          </Card>
          <Card className="p-6">
            <div className="font-serif text-xl">This week, by how it was booked</div>
            <div className="mt-4 h-44">
              <ResponsiveContainer>
                <BarChart data={channel} margin={{ left: -24 }}>
                  <XAxis dataKey="name" stroke="rgb(112 106 97)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgb(112 106 97)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "rgb(255 253 249)", border: "1px solid rgb(228 221 208)", borderRadius: 14, fontSize: 12 }} cursor={{ fill: "rgb(250 247 241)" }} />
                  <Bar dataKey="phone" name={`By ${agent}`} stackId="a" fill="rgb(150 118 70)" />
                  <Bar dataKey="other" name="Front desk / online" stackId="a" fill="rgb(228 221 208)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-6">
            <div className="font-serif text-xl">House rules for bookings</div>
            <ul className="mt-3 space-y-1.5 text-sm text-atl-soft">
              <li>· Each service keeps its length and tidy-up time</li><li>· Only stylists who offer a service are offered</li><li>· Colour needs a patch test at least 48 hours before</li><li>· Nothing is booked until the caller says yes</li><li>· A repeated request can never book twice</li>
            </ul>
          </Card>
          <DemoNote>Demo diary. Bookings made in the Rehearsal room appear here too.</DemoNote>
        </div>
      </div>
    </div>
  );
}
