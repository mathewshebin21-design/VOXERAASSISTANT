"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PageHead, Stat, Tag } from "@/components/command/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries, hourlyHeatmap, inRange, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { DEMO_TODAY, addDays, dayNum, fmtDuration, fmtTime, gbp, monthShort } from "@/lib/time";
import type { CallOutcome, Intent } from "@/lib/types";

const RANGES = [7, 14, 28] as const;
const tip = { contentStyle: { background: "rgb(17 17 22)", border: "1px solid rgb(42 42 52)", borderRadius: 6, fontSize: 12 }, labelStyle: { color: "rgb(140 140 158)" } };
const axis = { stroke: "rgb(140 140 158)", fontSize: 11, tickLine: false, axisLine: false } as const;

export default function Ops() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const from = addDays(DEMO_TODAY, -(range - 1));
  const calls = useMemo(() => inRange(CALLS, from, DEMO_TODAY), [from]);
  const prev = useMemo(() => computeMetrics(inRange(CALLS, addDays(from, -range), addDays(from, -1))), [from, range]);
  const m = useMemo(() => computeMetrics(calls), [calls]);
  const series = useMemo(() => dailySeries(CALLS, from, DEMO_TODAY).map((d) => ({ ...d, label: `${dayNum(d.date)} ${monthShort(d.date)}` })), [from]);
  const heat = useMemo(() => hourlyHeatmap(calls), [calls]);
  const heatMax = Math.max(1, ...heat.flat());
  const delta = (a: number, b: number) => (b === 0 ? "—" : `${a >= b ? "▲" : "▼"} ${Math.abs(((a - b) / b) * 100).toFixed(0)}% vs prev`);
  const outcomes = (Object.entries(m.byOutcome) as [CallOutcome, number][]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const intents = (Object.entries(m.byIntent) as [Intent, number][]).sort((a, b) => b[1] - a[1]);
  const recent = calls.slice(0, 7);

  return (
    <>
      <PageHead kicker="Operate · overview" title="Operations">
        <div className="flex rounded-md border border-cmd-line p-0.5 font-mono text-xs" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={r === range} onClick={() => setRange(r)} className={clsx("rounded px-2.5 py-1", r === range ? "bg-cmd-violet text-white" : "text-cmd-mute hover:text-cmd-text")}>{r}d</button>
          ))}
        </div>
        <Tag tone="warn">Simulated data</Tag>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Total calls" value={m.total} sub={delta(m.total, prev.total)} href="/command/calls" />
        <Stat label="Answered" value={`${(m.answerRate * 100).toFixed(1)}%`} sub={`${m.answered} answered · ${m.missed} missed`} tone="ok" href="/command/calls?status=missed" />
        <Stat label="Bookings" value={m.booked} sub={`${(m.bookingConversion * 100).toFixed(0)}% of booking/price enquiries`} tone="violet" href="/command/calls?outcome=booked" />
        <Stat label="Transfers" value={m.transferred} sub="to front desk" tone="cyan" href="/command/calls?outcome=transferred" />
        <Stat label="Latency p50 / p95" value={`${m.latencyP50Ms}/${m.latencyP95Ms}`} sub="ms · simulated, not measured" tone={m.latencyP95Ms > 1200 ? "warn" : "text"} />
        <Stat label="Cost / booking" value={gbp(m.costPerBookingGBP)} sub={`${gbp(m.costPerMinuteGBP, 3)}/min · assumption-based`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Call volume & bookings" className="xl:col-span-2" action={<span className="font-mono text-[10px] text-cmd-mute">daily</span>}>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
                <defs>
                  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(139 92 246)" stopOpacity={0.5} /><stop offset="1" stopColor="rgb(139 92 246)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(34 211 238)" stopOpacity={0.45} /><stop offset="1" stopColor="rgb(34 211 238)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="rgb(42 42 52)" vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tip} />
                <Area type="monotone" dataKey="calls" name="Calls" stroke="rgb(139 92 246)" fill="url(#gv)" strokeWidth={2} />
                <Area type="monotone" dataKey="booked" name="Booked" stroke="rgb(34 211 238)" fill="url(#gc)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Outcomes" action={<span className="font-mono text-[10px] text-cmd-mute">click for evidence</span>}>
          <ul className="space-y-2">
            {outcomes.map(([o, n]) => (
              <li key={o}>
                <Link href={`/command/calls?outcome=${o}`} className="group block">
                  <div className="flex justify-between text-sm"><span className="group-hover:text-cmd-violet">{OUTCOME_LABEL[o]}</span><span className="font-mono tabular-nums text-cmd-mute">{n}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-cmd-raised">
                    <div className={clsx("h-full rounded", o === "failed" || o === "abandoned" || o === "no_answer" ? "bg-cmd-bad/70" : o === "transferred" ? "bg-cmd-cyan" : "bg-cmd-violet")} style={{ width: `${(n / m.total) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Voice latency p50 (simulated)">
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: -20, right: 4, top: 8 }}>
                <CartesianGrid stroke="rgb(42 42 52)" vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} domain={[400, 1400]} />
                <Tooltip {...tip} />
                <ReferenceLine y={1000} stroke="rgb(251 191 36)" strokeDasharray="4 4" label={{ value: "1s target", fill: "rgb(251 191 36)", fontSize: 10, position: "insideTopRight" }} />
                <Line type="monotone" dataKey="latencyP50Ms" name="p50 ms" stroke="rgb(34 211 238)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-cmd-mute">Values are generated for the preview. Real latency will be measured per turn in Phase 3.</p>
        </Panel>
        <Panel title="Caller intents">
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={intents.map(([k, v]) => ({ name: INTENT_LABEL[k], v }))} layout="vertical" margin={{ left: 30, right: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" {...axis} width={110} />
                <Tooltip {...tip} cursor={{ fill: "rgb(26 26 33)" }} />
                <Bar dataKey="v" name="Calls" fill="rgb(139 92 246)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Demand heatmap · weekday × hour" className="lg:col-span-2 xl:col-span-1">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[3px] font-mono text-[10px] text-cmd-mute">
              <thead><tr><th />{Array.from({ length: 15 }, (_, i) => <th key={i} className="font-normal">{(i + 7) % 3 === 0 ? i + 7 : ""}</th>)}</tr></thead>
              <tbody>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, r) => (
                  <tr key={d}><th className="pr-1 text-left font-normal">{d}</th>
                    {heat[r].map((v, c) => <td key={c} title={`${d} ${c + 7}:00 — ${v} calls`} className="h-4 min-w-[12px] rounded-sm" style={{ background: v ? `rgb(139 92 246 / ${0.12 + (v / heatMax) * 0.88})` : "rgb(26 26 33)" }} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-cmd-mute">Monday calls are handled even though the studio is closed.</p>
        </Panel>
      </div>

      <Panel title="Latest calls" className="mt-4" dense action={<Link href="/command/calls" className="font-mono text-[11px] text-cmd-violet hover:underline">all calls →</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {recent.map((c) => (
                <tr key={c.id} className="border-t border-cmd-line first:border-0 hover:bg-cmd-raised/60">
                  <td className="px-4 py-2 font-mono text-xs text-cmd-mute">{fmtTime(c.timeMin)}</td>
                  <td className="px-2 py-2"><Link className="hover:text-cmd-violet" href={`/command/calls/${c.id}`}>{c.callerName}</Link></td>
                  <td className="px-2 py-2 text-cmd-mute">{INTENT_LABEL[c.intent]}</td>
                  <td className="px-2 py-2"><Tag tone={c.outcome === "booked" ? "violet" : c.outcome === "transferred" ? "cyan" : c.outcome === "failed" || c.outcome === "no_answer" ? "bad" : "mute"}>{OUTCOME_LABEL[c.outcome]}</Tag></td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-cmd-mute">{fmtDuration(c.durationSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
