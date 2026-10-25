"use client";

import { clsx } from "clsx";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHead, Panel, Stat, Tag } from "@/components/command/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries } from "@/lib/metrics";
import { COST_ASSUMPTIONS, GBP_PER_MIN, PLANS, USD_TO_GBP } from "@/lib/pricing";
import { DEMO_TODAY, addDays, dayNum, gbp } from "@/lib/time";

export default function Billing() {
  const plan = PLANS[1];
  const from = "2026-10-01";
  const mtd = useMemo(() => computeMetrics(CALLS.filter((c) => c.date >= from && c.date <= DEMO_TODAY)), []);
  const series = useMemo(() => {
    let cum = 0;
    return dailySeries(CALLS, from, DEMO_TODAY).map((d) => ({ day: dayNum(d.date), minutes: d.minutes, cum: +(cum += d.minutes).toFixed(0) }));
  }, []);
  const used = mtd.totalMinutes;
  const daysElapsed = Number(DEMO_TODAY.slice(8));
  const projected = (used / daysElapsed) * 31;
  const over = Math.max(0, projected - plan.includedMinutes);
  return (
    <>
      <PageHead kicker="Admin · usage" title="Usage & billing"><Tag tone="warn">Draft pricing · nothing is charged</Tag></PageHead>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Plan" value={plan.name} sub={`${gbp(plan.monthlyGBP, 0)}/mo · ${plan.includedMinutes} min`} tone="violet" />
        <Stat label="Minutes used · Oct" value={used.toFixed(0)} sub={`${((used / plan.includedMinutes) * 100).toFixed(0)}% of allowance`} tone={used > plan.includedMinutes ? "warn" : "text"} />
        <Stat label="Projected month end" value={projected.toFixed(0)} sub={over ? `≈ ${gbp(over * plan.overagePerMinGBP)} overage` : "within allowance"} tone={over ? "warn" : "ok"} />
        <Stat label="Est. provider cost · Oct" value={gbp(mtd.totalCostGBP)} sub={`${gbp(GBP_PER_MIN, 3)}/min assumption`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="Cumulative minutes · October">
          <div className="h-64"><ResponsiveContainer>
            <BarChart data={series} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="rgb(42 42 52)" vertical={false} />
              <XAxis dataKey="day" stroke="rgb(140 140 158)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="rgb(140 140 158)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "rgb(17 17 22)", border: "1px solid rgb(42 42 52)", fontSize: 12 }} cursor={{ fill: "rgb(26 26 33)" }} />
              <ReferenceLine y={plan.includedMinutes} stroke="rgb(251 191 36)" strokeDasharray="4 4" label={{ value: "allowance", fill: "rgb(251 191 36)", fontSize: 10, position: "insideTopLeft" }} />
              <Bar dataKey="cum" name="Cumulative min" fill="rgb(139 92 246)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer></div>
        </Panel>
        <Panel title="Cost model (per minute)" dense>
          <table className="w-full text-sm"><tbody>
            {COST_ASSUMPTIONS.map((c) => <tr key={c.component} className="border-t border-cmd-line first:border-0"><td className="px-4 py-2">{c.component}<div className="text-[11px] text-cmd-mute">{c.assumption}</div></td><td className="px-4 text-right font-mono text-xs">${c.usdPerMin.toFixed(4)}</td></tr>)}
            <tr className="border-t border-cmd-line bg-cmd-raised/50"><td className="px-4 py-2 font-medium">Total @ {USD_TO_GBP} GBP/USD</td><td className="px-4 text-right font-mono text-xs">{gbp(GBP_PER_MIN, 4)}</td></tr>
          </tbody></table>
          <p className="border-t border-cmd-line px-4 py-2 text-[11px] text-cmd-mute">Planning estimates from public list prices (Phase 0). To be replaced by metered provider costs.</p>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={clsx("rounded-lg border p-5", p.id === plan.id ? "border-cmd-violet bg-cmd-violet/5" : "border-cmd-line bg-cmd-panel")}>
            <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span>{p.id === plan.id && <Tag tone="violet">current</Tag>}</div>
            <div className="mt-2 font-mono text-2xl">{gbp(p.monthlyGBP, 0)}<span className="text-sm text-cmd-mute">/mo</span></div>
            <div className="text-xs text-cmd-mute">{p.includedMinutes} min incl. · {gbp(p.overagePerMinGBP)}/min after · setup {p.setupFeeGBP ? gbp(p.setupFeeGBP, 0) : "free"}</div>
            <ul className="mt-3 space-y-1 text-sm text-cmd-mute">{p.features.map((f) => <li key={f}>· {f}</li>)}</ul>
            <div className="mt-3 text-[11px] text-cmd-mute">Est. gross margin at allowance: {(((p.monthlyGBP - p.includedMinutes * GBP_PER_MIN) / p.monthlyGBP) * 100).toFixed(0)}% (provider cost only)</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-cmd-mute">Invoices, payment methods and VAT handling are out of scope for the preview. Range: 1 Oct – {dayNum(DEMO_TODAY)} Oct ({addDays(DEMO_TODAY, 0)}).</p>
    </>
  );
}
