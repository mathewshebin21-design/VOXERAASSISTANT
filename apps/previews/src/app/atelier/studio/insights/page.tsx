"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries, hourlyHeatmap, inRange, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { DEMO_TODAY, addDays, dayNum, fmtDuration, fmtTime, gbp, monthShort, relativeDay } from "@/lib/time";
import type { CallOutcome, Intent } from "@/lib/types";

const INK = "rgb(38 37 35)", CHAMP = "rgb(150 118 70)", SOFT = "rgb(112 106 97)", LINE = "rgb(228 221 208)", SAGE = "rgb(120 140 112)", ROSE = "rgb(176 104 92)";
const tip = { contentStyle: { background: "rgb(255 253 249)", border: `1px solid ${LINE}`, borderRadius: 14, fontSize: 12 } };
const axis = { stroke: SOFT, fontSize: 11, tickLine: false, axisLine: false } as const;

function Ring({ value, label, sub, color }: { value: number; label: string; sub: string; color: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="h-20 w-20 shrink-0">
        <ResponsiveContainer>
          <RadialBarChart innerRadius="74%" outerRadius="100%" data={[{ v: value * 100 }]} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="v" cornerRadius={10} fill={color} background={{ fill: LINE }} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div><div className="font-serif text-4xl">{(value * 100).toFixed(0)}%</div><div className="text-sm">{label}</div><div className="text-xs text-atl-soft">{sub}</div></div>
    </Card>
  );
}

export default function Insights() {
  const [days, setDays] = useState(14);
  const from = addDays(DEMO_TODAY, -(days - 1));
  const calls = useMemo(() => inRange(CALLS, from, DEMO_TODAY), [from]);
  const m = useMemo(() => computeMetrics(calls), [calls]);
  const prev = useMemo(() => computeMetrics(inRange(CALLS, addDays(from, -days), addDays(from, -1))), [from, days]);
  const series = useMemo(() => dailySeries(CALLS, from, DEMO_TODAY).map((d) => ({ ...d, label: `${dayNum(d.date)} ${monthShort(d.date)}` })), [from]);
  const heat = useMemo(() => hourlyHeatmap(calls), [calls]);
  const heatMax = Math.max(1, ...heat.flat());
  const outcomes = (Object.entries(m.byOutcome) as [CallOutcome, number][]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const intents = (Object.entries(m.byIntent) as [Intent, number][]).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: INTENT_LABEL[k], v }));
  const routes = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calls) map.set(`${c.intent}|${c.outcome}`, (map.get(`${c.intent}|${c.outcome}`) ?? 0) + 1);
    return [...map.entries()].map(([k, n]) => { const [i, o] = k.split("|"); return { intent: i as Intent, outcome: o as CallOutcome, n }; }).sort((a, b) => b.n - a.n).slice(0, 8);
  }, [calls]);
  const delta = (a: number, b: number) => (b === 0 ? "" : `${a >= b ? "up" : "down"} ${Math.abs(((a - b) / b) * 100).toFixed(0)}% on the previous ${days} days`);

  const tiles: [string, string, string, string?][] = [
    ["Calls", String(m.total), delta(m.total, prev.total), "/atelier/studio/calls"],
    ["Answered", `${(m.answerRate * 100).toFixed(1)}%`, `${m.answered} answered · ${m.missed} missed`, "/atelier/studio/calls?status=missed"],
    ["Booked by phone", String(m.booked), `${(m.bookingConversion * 100).toFixed(0)}% of booking & price enquiries`, "/atelier/studio/calls?outcome=booked"],
    ["Handed to the team", String(m.transferred), `${m.messages} messages taken`, "/atelier/studio/calls?outcome=transferred"],
    ["Average call", fmtDuration(m.avgDurationSec), `${m.totalMinutes.toFixed(0)} minutes in total`],
    ["Response time", `${m.latencyP50Ms} ms`, `typical · slowest 5% ${m.latencyP95Ms} ms (simulated)`],
    ["Cost per booking", gbp(m.costPerBookingGBP), `${gbp(m.costPerMinuteGBP, 3)} a minute, estimated`],
    ["Unfinished", String(m.failed), "flagged for your review", "/atelier/studio/calls?outcome=failed"],
  ];

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Insights</Eyebrow><Title className="mt-4">How the phone has been.</Title></div>
        <div className="flex items-center gap-2">
          {[7, 14, 28].map((d) => <button key={d} onClick={() => setDays(d)} aria-pressed={d === days} className={clsx("rounded-full px-4 py-2 text-sm ring-1", d === days ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>{d} days</button>)}
          <Pill tone="champ">demo records</Pill>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-atl-line bg-atl-line lg:grid-cols-4">
        {tiles.map(([k, v, s, href]) => {
          const body = <div className="h-full bg-atl-paper p-6 transition hover:bg-atl-bg"><div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{k}</div><div className="mt-2 font-serif text-4xl">{v}</div><div className="mt-1 text-xs text-atl-soft">{s}</div></div>;
          return href ? <Link key={k} href={href} title="See the calls behind this figure">{body}</Link> : <div key={k}>{body}</div>;
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Ring value={m.answerRate} label="Calls answered" sub={`${m.answered} of ${m.total}`} color={SAGE} />
        <Ring value={m.bookingConversion} label="Enquiries that booked" sub={`${m.booked} bookings`} color={CHAMP} />
        <Ring value={m.total ? (m.transferred + m.messages) / m.total : 0} label="Handed to a person" sub={`${m.transferred} transfers · ${m.messages} messages`} color={ROSE} />
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-6 sm:p-8">
          <H2>Calls and bookings, day by day</H2>
          <div className="mt-6 h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
                <defs><linearGradient id="ia" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={CHAMP} stopOpacity={0.35} /><stop offset="1" stopColor={CHAMP} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tip} />
                <Area type="monotone" dataKey="calls" name="Calls" stroke={CHAMP} strokeWidth={1.5} fill="url(#ia)" />
                <Area type="monotone" dataKey="booked" name="Booked" stroke={INK} strokeWidth={1.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6 sm:p-8">
          <H2>How calls ended</H2>
          <p className="mt-1 text-xs text-atl-soft">Select a line to read those conversations.</p>
          <ul className="mt-5 space-y-3">
            {outcomes.map(([o, n]) => (
              <li key={o}><Link href={`/atelier/studio/calls?outcome=${o}`} className="group block">
                <div className="flex justify-between text-sm"><span className="group-hover:text-atl-champdeep">{OUTCOME_LABEL[o]}</span><span className="font-serif text-lg">{n}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-atl-line"><div className={clsx("h-full rounded-full", o === "failed" || o === "abandoned" || o === "no_answer" ? "bg-atl-rose" : o === "transferred" || o === "message_taken" ? "bg-atl-sage" : "bg-atl-champdeep")} style={{ width: `${(n / m.total) * 100}%` }} /></div>
              </Link></li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-6 sm:p-8">
          <H2>Response time</H2>
          <p className="mt-1 text-xs text-atl-soft">Typical pause before {"the receptionist"} replies. Simulated for the preview; measured per turn from Phase 3.</p>
          <div className="mt-4 h-48">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} domain={[400, 1400]} />
                <Tooltip {...tip} />
                <ReferenceLine y={1000} stroke={ROSE} strokeDasharray="4 4" label={{ value: "1 second", fill: ROSE, fontSize: 10, position: "insideTopRight" }} />
                <Line type="monotone" dataKey="latencyP50Ms" name="Typical ms" stroke={CHAMP} strokeWidth={1.8} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6 sm:p-8">
          <H2>Why people called</H2>
          <div className="mt-4 h-56">
            <ResponsiveContainer>
              <BarChart data={intents} layout="vertical" margin={{ left: 30, right: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" {...axis} width={110} />
                <Tooltip {...tip} cursor={{ fill: "rgb(250 247 241)" }} />
                <Bar dataKey="v" name="Calls" fill={CHAMP} radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6 sm:p-8 lg:col-span-2 xl:col-span-1">
          <H2>When the phone rings</H2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-separate border-spacing-[3px] text-[10px] text-atl-soft">
              <thead><tr><th />{Array.from({ length: 15 }, (_, i) => <th key={i} className="font-normal">{(i + 7) % 3 === 0 ? i + 7 : ""}</th>)}</tr></thead>
              <tbody>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, r) => (
                  <tr key={d}><th className="pr-1 text-left font-normal">{d}</th>
                    {heat[r].map((v, c) => <td key={c} title={`${d} ${c + 7}:00 — ${v} calls`} className="h-4 min-w-[12px] rounded" style={{ background: v ? `rgb(150 118 70 / ${0.12 + (v / heatMax) * 0.88})` : "rgb(250 247 241)" }} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-atl-soft">Mondays are answered even though the studio is closed.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Card className="p-6 sm:p-8">
          <H2>Where conversations led</H2>
          <p className="mt-1 text-xs text-atl-soft">What callers wanted, and how each conversation ended.</p>
          <ul className="mt-5 space-y-3">
            {routes.map((r) => (
              <li key={r.intent + r.outcome}><Link href={`/atelier/studio/calls?intent=${r.intent}&outcome=${r.outcome}`} className="group block">
                <div className="flex items-center gap-2 text-sm"><span>{INTENT_LABEL[r.intent]}</span><span className="text-atl-soft">→</span><span className="italic text-atl-champdeep">{OUTCOME_LABEL[r.outcome]}</span><span className="ml-auto font-serif text-lg">{r.n}</span></div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-atl-line"><div className="h-full rounded-full bg-gradient-to-r from-atl-champ to-atl-champdeep" style={{ width: `${(r.n / (routes[0]?.n || 1)) * 100}%` }} /></div>
              </Link></li>
            ))}
          </ul>
        </Card>
        <Card className="p-6 sm:p-8">
          <H2>Latest conversations</H2>
          <ul className="mt-5 divide-y divide-atl-line">
            {calls.slice(0, 7).map((c) => (
              <li key={c.id}><Link href={`/atelier/studio/calls/${c.id}`} className="flex items-center gap-3 py-3 hover:text-atl-champdeep">
                <span className="w-24 text-xs text-atl-soft">{relativeDay(c.date)} {fmtTime(c.timeMin)}</span>
                <span className="min-w-0 flex-1 truncate">{c.callerName}</span>
                <Pill tone={c.outcome === "booked" ? "champ" : c.outcome === "failed" || c.outcome === "no_answer" ? "rose" : "plain"}>{OUTCOME_LABEL[c.outcome]}</Pill>
              </Link></li>
            ))}
          </ul>
        </Card>
      </div>
      <DemoNote>Every figure is calculated from the demo call records shown in the Journal — select any figure to see the calls behind it.</DemoNote>
    </div>
  );
}
