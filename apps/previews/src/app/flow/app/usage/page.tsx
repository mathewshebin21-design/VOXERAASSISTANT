"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, Glass, GHead, Heading } from "@/components/flow/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries } from "@/lib/metrics";
import { COST_ASSUMPTIONS, GBP_PER_MIN, PLANS, USD_TO_GBP } from "@/lib/pricing";
import { DEMO_TODAY, dayNum, gbp } from "@/lib/time";

export default function Usage() {
  const plan = PLANS[1];
  const m = useMemo(() => computeMetrics(CALLS.filter((c) => c.date >= "2026-10-01" && c.date <= DEMO_TODAY)), []);
  const series = useMemo(() => { let cum = 0; return dailySeries(CALLS, "2026-10-01", DEMO_TODAY).map((d) => ({ day: dayNum(d.date), cum: +(cum += d.minutes).toFixed(0), cost: d.costGBP })); }, []);
  const share = COST_ASSUMPTIONS.map((c) => ({ ...c, pct: c.usdPerMin / COST_ASSUMPTIONS.reduce((s, x) => s + x.usdPerMin, 0) }));
  return (
    <>
      <Heading kicker="Usage" title="Minutes, cost and plan"><Chip tone="amber">estimates · nothing billed</Chip></Heading>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Minutes · Oct", m.totalMinutes.toFixed(0), `of ${plan.includedMinutes} on ${plan.name}`], ["Calls answered", m.answered, `${m.missed} missed`], ["Est. provider cost", gbp(m.totalCostGBP), `${gbp(GBP_PER_MIN, 3)}/min`], ["Est. cost / booking", gbp(m.costPerBookingGBP), `${m.booked} bookings`]].map(([k, v, s]) => (
          <Glass key={String(k)} className="p-4"><div className="text-xs text-flw-mute">{k}</div><div className="mt-1 font-display text-3xl font-semibold">{v}</div><div className="text-xs text-flw-mute">{s}</div></Glass>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Glass>
          <GHead title="Cumulative minutes vs allowance" />
          <div className="h-72 p-4"><ResponsiveContainer>
            <AreaChart data={series} margin={{ left: -12, right: 8, top: 8 }}>
              <defs><linearGradient id="fu" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgb(167 139 250)" stopOpacity={0.6} /><stop offset="1" stopColor="rgb(103 232 249)" stopOpacity={0.05} /></linearGradient></defs>
              <CartesianGrid stroke="rgb(44 40 70)" vertical={false} />
              <XAxis dataKey="day" stroke="rgb(150 146 180)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="rgb(150 146 180)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "rgb(22 20 38)", border: "1px solid rgb(44 40 70)", borderRadius: 12, fontSize: 12 }} />
              <ReferenceLine y={plan.includedMinutes} stroke="rgb(252 211 77)" strokeDasharray="4 4" />
              <Area dataKey="cum" name="Minutes" stroke="rgb(167 139 250)" strokeWidth={2} fill="url(#fu)" type="monotone" />
            </AreaChart>
          </ResponsiveContainer></div>
        </Glass>
        <Glass>
          <GHead title="Per-minute cost stack (assumptions)" />
          <div className="space-y-3 p-4">
            <div className="flex h-3 overflow-hidden rounded-full">{share.map((c, i) => <div key={c.component} style={{ width: `${c.pct * 100}%`, background: ["rgb(167 139 250)", "rgb(103 232 249)", "rgb(244 114 182)", "rgb(190 242 100)", "rgb(252 211 77)"][i] }} />)}</div>
            {share.map((c, i) => <div key={c.component} className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: ["rgb(167 139 250)", "rgb(103 232 249)", "rgb(244 114 182)", "rgb(190 242 100)", "rgb(252 211 77)"][i] }} /><span className="flex-1">{c.component}</span><span className="font-mono text-xs text-flw-mute">${c.usdPerMin.toFixed(4)}</span></div>)}
            <p className="text-xs text-flw-mute">≈ {gbp(GBP_PER_MIN, 4)}/min at {USD_TO_GBP} GBP/USD, from public list prices. Replaced by metered costs in Phase 10.</p>
          </div>
        </Glass>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {PLANS.map((p) => (
          <Glass key={p.id} glow={p.id === plan.id ? "violet" : undefined} className="p-5">
            <div className="flex items-center justify-between"><span className="font-display text-lg">{p.name}</span>{p.id === plan.id && <Chip tone="violet">current</Chip>}</div>
            <div className="mt-2 font-display text-3xl font-semibold">{gbp(p.monthlyGBP, 0)}<span className="text-sm text-flw-mute">/mo</span></div>
            <div className="text-xs text-flw-mute">{p.includedMinutes} min · {gbp(p.overagePerMinGBP)}/min after · setup {p.setupFeeGBP ? gbp(p.setupFeeGBP, 0) : "free"}</div>
            <ul className="mt-3 space-y-1 text-sm text-flw-mute">{p.features.map((f) => <li key={f}>· {f}</li>)}</ul>
            <div className="mt-3 text-[11px] text-flw-mute">Est. gross margin at allowance: {(((p.monthlyGBP - p.includedMinutes * GBP_PER_MIN) / p.monthlyGBP) * 100).toFixed(0)}% (provider cost only)</div>
          </Glass>
        ))}
      </div>
    </>
  );
}
