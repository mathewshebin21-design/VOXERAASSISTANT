"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, Glass, GHead, Heading } from "@/components/flow/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries, hourlyHeatmap, inRange, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { DEMO_TODAY, addDays, dayNum, fmtDuration, fmtTime, gbp, monthShort, relativeDay } from "@/lib/time";
import type { CallOutcome, Intent } from "@/lib/types";

const V = "rgb(167 139 250)", C = "rgb(103 232 249)", P = "rgb(244 114 182)", A = "rgb(252 211 77)", MUTE = "rgb(150 146 180)", LINE = "rgb(44 40 70)";
const tip = { contentStyle: { background: "rgb(22 20 38)", border: `1px solid ${LINE}`, borderRadius: 12, fontSize: 12 } };
const axis = { stroke: MUTE, fontSize: 11, tickLine: false, axisLine: false } as const;

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
  const delta = (a: number, b: number) => (b === 0 ? "—" : `${a >= b ? "▲" : "▼"} ${Math.abs(((a - b) / b) * 100).toFixed(0)}% vs previous ${days}d`);
  const tiles: [string, string, string, string?][] = [
    ["Total calls", String(m.total), delta(m.total, prev.total), "/flow/app/calls"],
    ["Answered", `${(m.answerRate * 100).toFixed(1)}%`, `${m.answered} answered · ${m.missed} missed`, "/flow/app/calls?status=missed"],
    ["Bookings", String(m.booked), `${(m.bookingConversion * 100).toFixed(0)}% of booking/price enquiries`, "/flow/app/calls?outcome=booked"],
    ["Transfers", String(m.transferred), `${m.messages} messages taken`, "/flow/app/calls?outcome=transferred"],
    ["Avg duration", fmtDuration(m.avgDurationSec), `${m.totalMinutes.toFixed(0)} min total`],
    ["Latency p50 / p95", `${m.latencyP50Ms}/${m.latencyP95Ms}`, "ms · simulated, not measured"],
    ["Cost / booking", gbp(m.costPerBookingGBP), `${gbp(m.costPerMinuteGBP, 3)}/min · estimate`],
    ["Failed", String(m.failed), "flagged for review", "/flow/app/calls?outcome=failed"],
  ];

  return (
    <>
      <Heading kicker="Insights" title="Call analytics">
        {[7, 14, 28].map((d) => <button key={d} onClick={() => setDays(d)} aria-pressed={d === days} className={clsx("rounded-xl px-3 py-1.5 font-mono text-xs", d === days ? "bg-flw-violet/25 text-flw-violet" : "text-flw-mute hover:text-flw-text")}>{d}d</button>)}
        <Chip tone="amber">synthetic records</Chip>
      </Heading>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([k, v, s, href]) => {
          const body = <Glass className="h-full p-4 transition hover:border-flw-violet/60"><div className="text-xs text-flw-mute">{k}</div><div className="mt-1 font-display text-3xl font-semibold">{v}</div><div className="mt-1 text-xs text-flw-mute">{s}</div></Glass>;
          return href ? <Link key={k} href={href} title="Open the calls behind this number">{body}</Link> : <div key={k}>{body}</div>;
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Glass>
          <GHead title="Volume & bookings" />
          <div className="h-64 p-4"><ResponsiveContainer>
            <AreaChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
              <defs><linearGradient id="fi" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={V} stopOpacity={0.5} /><stop offset="1" stopColor={V} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" /><YAxis {...axis} allowDecimals={false} /><Tooltip {...tip} />
              <Area type="monotone" dataKey="calls" name="Calls" stroke={V} strokeWidth={2} fill="url(#fi)" />
              <Area type="monotone" dataKey="booked" name="Booked" stroke={C} strokeWidth={2} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer></div>
        </Glass>
        <Glass>
          <GHead title="Outcomes" right={<span className="text-xs text-flw-mute">click for evidence</span>} />
          <ul className="space-y-2.5 p-4">
            {outcomes.map(([o, n]) => (
              <li key={o}><Link href={`/flow/app/calls?outcome=${o}`} className="group block">
                <div className="flex justify-between text-sm"><span className="group-hover:text-flw-cyan">{OUTCOME_LABEL[o]}</span><span className="font-mono text-xs text-flw-mute">{n}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-flw-line/60"><div className="h-full rounded-full" style={{ width: `${(n / m.total) * 100}%`, background: o === "failed" || o === "abandoned" || o === "no_answer" ? P : o === "transferred" || o === "message_taken" ? "rgb(190 242 100)" : `linear-gradient(90deg, ${V}, ${C})` }} /></div>
              </Link></li>
            ))}
          </ul>
        </Glass>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Glass>
          <GHead title="Voice latency p50 (simulated)" />
          <div className="h-52 p-4"><ResponsiveContainer>
            <LineChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
              <CartesianGrid stroke={LINE} vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" /><YAxis {...axis} domain={[400, 1400]} /><Tooltip {...tip} />
              <ReferenceLine y={1000} stroke={A} strokeDasharray="4 4" label={{ value: "1s target", fill: A, fontSize: 10, position: "insideTopRight" }} />
              <Line type="monotone" dataKey="latencyP50Ms" name="p50 ms" stroke={C} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer></div>
          <p className="px-4 pb-4 text-xs text-flw-mute">Generated values; real per-turn latency is measured in Phase 3.</p>
        </Glass>
        <Glass>
          <GHead title="Caller intents" />
          <div className="h-56 p-4"><ResponsiveContainer>
            <BarChart data={intents} layout="vertical" margin={{ left: 30, right: 10 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" {...axis} width={110} /><Tooltip {...tip} cursor={{ fill: "rgb(44 40 70 / .4)" }} />
              <Bar dataKey="v" name="Calls" fill={V} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer></div>
        </Glass>
        <Glass className="lg:col-span-2 xl:col-span-1">
          <GHead title="Demand · weekday × hour" />
          <div className="overflow-x-auto p-4">
            <table className="w-full border-separate border-spacing-[3px] font-mono text-[10px] text-flw-mute">
              <thead><tr><th />{Array.from({ length: 15 }, (_, i) => <th key={i} className="font-normal">{(i + 7) % 3 === 0 ? i + 7 : ""}</th>)}</tr></thead>
              <tbody>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, r) => (
                <tr key={d}><th className="pr-1 text-left font-normal">{d}</th>{heat[r].map((v, c) => <td key={c} title={`${d} ${c + 7}:00 — ${v} calls`} className="h-4 min-w-[12px] rounded" style={{ background: v ? `rgb(103 232 249 / ${0.1 + (v / heatMax) * 0.9})` : "rgb(22 20 38)" }} />)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Glass>
      </div>
      <Glass className="mt-4">
        <GHead title="Latest calls" right={<Link href="/flow/app/calls" className="text-xs text-flw-cyan">all calls →</Link>} />
        <ul>{calls.slice(0, 7).map((c) => (
          <li key={c.id}><Link href={`/flow/app/calls/${c.id}`} className="flex items-center gap-3 border-t border-flw-line/60 px-4 py-2.5 text-sm first:border-0 hover:bg-flw-surface/60">
            <span className="w-28 font-mono text-xs text-flw-mute">{relativeDay(c.date)} {fmtTime(c.timeMin)}</span><span className="min-w-0 flex-1 truncate">{c.callerName}</span>
            <Chip tone={c.outcome === "booked" ? "violet" : c.outcome === "failed" || c.outcome === "no_answer" ? "pink" : "cyan"}>{OUTCOME_LABEL[c.outcome]}</Chip>
          </Link></li>
        ))}</ul>
      </Glass>
    </>
  );
}
