"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { CALLS, serviceById, staffById } from "@/lib/demo-data";
import { computeMetrics, dailySeries, inRange, OUTCOME_LABEL } from "@/lib/metrics";
import { useAllAppointments, usePreview } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dayShort, fmtDateLong, fmtTime, gbp } from "@/lib/time";

export default function Today() {
  const agent = usePreview((s) => s.draft.persona.agentName);
  const knowledge = usePreview((s) => s.knowledge);
  const appts = useAllAppointments();
  const week = useMemo(() => computeMetrics(inRange(CALLS, addDays(DEMO_TODAY, -6), DEMO_TODAY)), []);
  const lastWeek = useMemo(() => computeMetrics(inRange(CALLS, addDays(DEMO_TODAY, -13), addDays(DEMO_TODAY, -7))), []);
  const series = useMemo(() => dailySeries(CALLS, addDays(DEMO_TODAY, -13), DEMO_TODAY).map((d) => ({ ...d, label: dayShort(d.date) })), []);
  const today = appts.filter((a) => a.date === DEMO_TODAY && a.status !== "cancelled").sort((a, b) => a.startMin - b.startMin);
  const attention = [
    ...CALLS.filter((c) => c.date >= addDays(DEMO_TODAY, -2) && (c.outcome === "message_taken" || c.outcome === "failed")).slice(0, 4).map((c) => ({ key: c.id, href: `/atelier/studio/calls/${c.id}`, title: c.outcome === "failed" ? `Unfinished call with ${c.callerName}` : `${c.callerName} would like a call back`, sub: c.summary, tone: c.outcome === "failed" ? "rose" : "champ" } as const)),
    ...knowledge.filter((k) => k.status !== "verified").map((k) => ({ key: k.id, href: "/atelier/studio/knowledge", title: k.status === "conflict" ? `Two answers for “${k.title}”` : `Please confirm “${k.title}”`, sub: k.conflictNote ?? "Rye won't mention this until you confirm it.", tone: "plain" } as const)),
  ];
  const upDown = week.booked >= lastWeek.booked ? "more" : "fewer";

  return (
    <div className="space-y-12">
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <Eyebrow>{fmtDateLong(DEMO_TODAY)} · {fmtTime(DEMO_NOW_MIN)}</Eyebrow>
          <Title className="mt-4">Good afternoon, Ada.</Title>
          <p className="mt-5 max-w-2xl font-serif text-2xl leading-snug text-atl-soft">
            This week {agent} answered <span className="text-atl-ink">{week.answered} calls</span> and booked <span className="text-atl-ink">{week.booked} appointments</span> — {Math.abs(week.booked - lastWeek.booked)} {upDown} than last week. {week.transferred} callers were handed to the team.
          </p>
          <div className="mt-4"><DemoNote>Figures are calculated from the demo call records, not live calls.</DemoNote></div>
        </div>
        <Card className="p-6">
          <div className="flex items-baseline justify-between"><span className="text-sm text-atl-soft">Calls, last fortnight</span><span className="font-serif text-3xl">{series.reduce((s, d) => s + d.calls, 0)}</span></div>
          <div className="mt-2 h-28">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                <defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgb(201 170 120)" stopOpacity={0.45} /><stop offset="1" stopColor="rgb(201 170 120)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} stroke="rgb(112 106 97)" interval={1} />
                <Tooltip contentStyle={{ background: "rgb(255 253 249)", border: "1px solid rgb(228 221 208)", borderRadius: 14, fontSize: 12 }} />
                <Area dataKey="calls" name="Calls" stroke="rgb(150 118 70)" strokeWidth={1.5} fill="url(#ag)" type="monotone" />
                <Area dataKey="booked" name="Booked" stroke="rgb(38 37 35)" strokeWidth={1.5} fill="transparent" type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-atl-line bg-atl-line md:grid-cols-4">
        {[
          ["Answered", `${(week.answerRate * 100).toFixed(0)}%`, `${week.missed} missed`],
          ["Booked by phone", String(week.booked), `${(week.bookingConversion * 100).toFixed(0)}% of enquiries`],
          ["Average call", `${Math.round(week.avgDurationSec / 60)}m ${week.avgDurationSec % 60}s`, "connected calls"],
          ["Cost per booking", gbp(week.costPerBookingGBP), "estimated"],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-atl-paper p-6"><div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{k}</div><div className="mt-2 font-serif text-4xl">{v}</div><div className="mt-1 text-xs text-atl-soft">{s}</div></div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-baseline justify-between"><H2>Today in the studio</H2><Link href="/atelier/studio/diary" className="text-sm text-atl-soft hover:text-atl-ink">Open diary →</Link></div>
          <ol className="mt-5 divide-y divide-atl-line border-y border-atl-line">
            {today.slice(0, 8).map((a) => (
              <li key={a.id} className={"flex items-center gap-4 py-3.5 " + (a.startMin + a.durationMin < DEMO_NOW_MIN ? "opacity-50" : "")}>
                <span className="w-14 font-serif text-xl">{fmtTime(a.startMin)}</span>
                <div className="min-w-0 flex-1"><div className="truncate">{a.customerName}</div><div className="truncate text-xs text-atl-soft">{serviceById(a.serviceId).name} · with {staffById(a.staffId).name.split(" ")[0]}</div></div>
                {a.bookedVia === "voice_agent" && <Pill tone="champ">booked by {agent}</Pill>}
              </li>
            ))}
            {!today.length && <li className="py-6 text-sm text-atl-soft">A quiet day — no appointments.</li>}
          </ol>
        </div>
        <div>
          <H2>Needs your eye</H2>
          <div className="mt-5 space-y-3">
            {attention.map((a) => (
              <Link key={a.key} href={a.href} className="group block">
                <Card as="div" className="flex items-start gap-4 p-5 transition group-hover:border-atl-champ">
                  <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (a.tone === "rose" ? "bg-atl-rose" : a.tone === "champ" ? "bg-atl-champ" : "bg-atl-soft/40")} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{a.title}</div><div className="mt-0.5 line-clamp-2 text-sm text-atl-soft">{a.sub}</div></div>
                  <ArrowRight size={16} className="mt-1 text-atl-soft transition group-hover:translate-x-0.5 group-hover:text-atl-ink" />
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <H2>How calls ended this week</H2>
        <div className="mt-5 flex flex-wrap gap-2">
          {Object.entries(week.byOutcome).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <Link key={k} href={`/atelier/studio/calls?outcome=${k}`} className="rounded-full border border-atl-line bg-atl-paper px-4 py-2 text-sm hover:border-atl-champ">
              {OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL]} <span className="ml-1 font-serif text-lg">{n}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
