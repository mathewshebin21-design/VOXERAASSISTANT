"use client";

import { clsx } from "clsx";
import { useMemo } from "react";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { CALLS } from "@/lib/demo-data";
import { computeMetrics } from "@/lib/metrics";
import { GBP_PER_MIN, PLANS } from "@/lib/pricing";
import { DEMO_TODAY, gbp } from "@/lib/time";

export default function Plan() {
  const plan = PLANS[1];
  const m = useMemo(() => computeMetrics(CALLS.filter((c) => c.date >= "2026-10-01" && c.date <= DEMO_TODAY)), []);
  const pct = Math.min(1, m.totalMinutes / plan.includedMinutes);
  const day = Number(DEMO_TODAY.slice(8));
  const projected = (m.totalMinutes / day) * 31;
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
      <div>
        <H2>Plans</H2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <Card key={p.id} className={clsx("p-8", p.id === plan.id && "ring-1 ring-atl-champdeep")}>
              <div className="flex items-center justify-between"><span className="font-serif text-2xl">{p.name}</span>{p.id === plan.id && <Pill tone="champ">Your plan</Pill>}</div>
              <div className="mt-4 font-serif text-5xl">{gbp(p.monthlyGBP, 0)}<span className="font-sans text-base text-atl-soft"> /month</span></div>
              <p className="mt-2 text-sm text-atl-soft">{p.includedMinutes} minutes included, then {gbp(p.overagePerMinGBP)} a minute. {p.setupFeeGBP ? `${gbp(p.setupFeeGBP, 0)} guided setup.` : "Self-serve setup."}</p>
              <ul className="mt-6 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="border-t border-atl-line pt-2">{f}</li>)}</ul>
            </Card>
          ))}
        </div>
        <div className="mt-4"><DemoNote>Draft pricing for discussion. Nothing is charged in the preview.</DemoNote></div>
      </div>
    </div>
  );
}
