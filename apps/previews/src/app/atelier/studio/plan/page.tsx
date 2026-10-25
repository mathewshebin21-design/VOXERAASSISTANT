"use client";

import { clsx } from "clsx";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics, dailySeries } from "@/lib/metrics";
import { COST_ASSUMPTIONS, GBP_PER_MIN, PLANS, USD_TO_GBP } from "@/lib/pricing";
import { DEMO_TODAY, dayNum, gbp } from "@/lib/time";

export default function Plan() {
  const plan = PLANS[1];
  const m = useMemo(() => computeMetrics(CALLS.filter((c) => c.date >= "2026-10-01" && c.date <= DEMO_TODAY)), []);
  const pct = Math.min(1, m.totalMinutes / plan.includedMinutes);
  const day = Number(DEMO_TODAY.slice(8));
  const projected = (m.totalMinutes / day) * 31;
  const series = useMemo(() => { let cum = 0; return dailySeries(CALLS, "2026-10-01", DEMO_TODAY).map((d) => ({ day: dayNum(d.date), cum: +(cum += d.minutes).toFixed(0) })); }, []);
  const totalUsd = COST_ASSUMPTIONS.reduce((x, c) => x + c.usdPerMin, 0);
  const TONES = ["rgb(150 118 70)", "rgb(201 170 120)", "rgb(176 104 92)", "rgb(120 140 112)", "rgb(112 106 97)"];
  return (
    <div className="space-y-12">
      <div><Eyebrow>Plan & usage</Eyebrow><Title className="mt-4">October, so far.</Title></div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
        <Card className="p-8 sm:p-10">
          <div className="flex items-baseline justify-between"><span className="font-serif text-2xl">{plan.name} plan</span><span className="text-atl-soft">{gbp(plan.monthlyGBP, 0)} a month</span></div>
          <div className="mt-8 flex items-end gap-3"><span className="font-serif text-7xl leading-none">{m.totalMinutes.toFixed(0)}</span><span className="pb-2 text-atl-soft">of {plan.includedMinutes} minutes</span></div>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-atl-line"><div className="h-full rounded-full bg-gradient-to-r from-atl-champ to-atl-champdeep" style={{ width: `${pct * 100}%` }} /></div>
          <p className="mt-4 text-sm text-atl-soft">At this pace you&apos;ll use about <span className="text-atl-ink">{projected.toFixed(0)} minutes</span> by month end{projected > plan.includedMinutes ? `, roughly ${gbp((projected - plan.includedMinutes) * plan.overagePerMinGBP)} beyond your allowance.` : " — comfortably within your plan."}</p>
        </Card>
        <Card className="p-8 sm:p-10">
          <H2>What a call costs us</H2>
          <dl className="mt-6 space-y-4">
            {[["Calls answered", m.answered], ["Appointments booked", m.booked], ["Estimated provider cost", gbp(m.totalCostGBP)], ["Per minute (estimate)", gbp(GBP_PER_MIN, 3)], ["Per booking (estimate)", gbp(m.costPerBookingGBP)]].map(([k, v]) => (
              <div key={String(k)} className="flex items-baseline justify-between border-b border-atl-line pb-3"><dt className="text-atl-soft">{k}</dt><dd className="font-serif text-2xl">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4"><DemoNote>Estimated from public list prices of telephony, speech and model providers; not an invoice.</DemoNote></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-8">
          <H2>Minutes through the month</H2>
          <div className="mt-6 h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: -16, right: 8, top: 8 }}>
                <defs><linearGradient id="pu" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgb(150 118 70)" stopOpacity={0.35} /><stop offset="1" stopColor="rgb(150 118 70)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="rgb(228 221 208)" vertical={false} />
                <XAxis dataKey="day" stroke="rgb(112 106 97)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgb(112 106 97)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "rgb(255 253 249)", border: "1px solid rgb(228 221 208)", borderRadius: 14, fontSize: 12 }} />
                <ReferenceLine y={plan.includedMinutes} stroke="rgb(176 104 92)" strokeDasharray="4 4" label={{ value: "your allowance", fill: "rgb(176 104 92)", fontSize: 10, position: "insideTopLeft" }} />
                <Area type="monotone" dataKey="cum" name="Minutes used" stroke="rgb(150 118 70)" strokeWidth={1.8} fill="url(#pu)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-8">
          <H2>Where a minute&apos;s cost goes</H2>
          <div className="mt-6 flex h-3 overflow-hidden rounded-full">{COST_ASSUMPTIONS.map((c, i) => <div key={c.component} style={{ width: `${(c.usdPerMin / totalUsd) * 100}%`, background: TONES[i] }} />)}</div>
          <ul className="mt-5 space-y-3 text-sm">
            {COST_ASSUMPTIONS.map((c, i) => (
              <li key={c.component} className="flex items-start gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONES[i] }} /><span className="flex-1">{c.component}<span className="block text-xs text-atl-soft">{c.assumption}</span></span><span className="font-serif text-lg">${c.usdPerMin.toFixed(4)}</span></li>
            ))}
          </ul>
          <p className="mt-4 border-t border-atl-line pt-3 text-sm">About <span className="font-serif text-lg">{gbp(GBP_PER_MIN, 3)}</span> a minute at {USD_TO_GBP} pounds to the dollar.</p>
        </Card>
      </div>

      <div>
        <H2>Plans</H2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <Card key={p.id} className={clsx("p-8", p.id === plan.id && "ring-1 ring-atl-champdeep")}>
              <div className="flex items-center justify-between"><span className="font-serif text-2xl">{p.name}</span>{p.id === plan.id && <Pill tone="champ">Your plan</Pill>}</div>
              <div className="mt-4 font-serif text-5xl">{gbp(p.monthlyGBP, 0)}<span className="font-sans text-base text-atl-soft"> /month</span></div>
              <p className="mt-2 text-sm text-atl-soft">{p.includedMinutes} minutes included, then {gbp(p.overagePerMinGBP)} a minute. {p.setupFeeGBP ? `${gbp(p.setupFeeGBP, 0)} guided setup.` : "Self-serve setup."}</p>
              <ul className="mt-6 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="border-t border-atl-line pt-2">{f}</li>)}</ul>
              <p className="mt-4 text-xs text-atl-soft">Estimated margin if the allowance is fully used: {(((p.monthlyGBP - p.includedMinutes * GBP_PER_MIN) / p.monthlyGBP) * 100).toFixed(0)}% (provider costs only)</p>
            </Card>
          ))}
        </div>
        <div className="mt-4"><DemoNote>Draft pricing for discussion. Nothing is charged in the preview.</DemoNote></div>
      </div>
    </div>
  );
}
