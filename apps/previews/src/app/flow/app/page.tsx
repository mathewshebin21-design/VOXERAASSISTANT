"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Chip, Glass, GHead, Heading, Orb } from "@/components/flow/ui";
import { CALLS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";
import { computeMetrics, dailySeries, inRange, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { DEMO_TODAY, addDays, dayShort, gbp } from "@/lib/time";
import type { CallOutcome, Intent } from "@/lib/types";
import { useReplay } from "@/lib/use-replay";

function Ring({ value, label, sub, color }: { value: number; label: string; sub: string; color: string }) {
  return (
    <Glass className="p-4">
      <div className="flex items-center gap-3">
        <div className="h-20 w-20">
          <ResponsiveContainer>
            <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ v: value * 100 }]} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="v" cornerRadius={10} fill={`rgb(${color})`} background={{ fill: "rgb(44 40 70)" }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div><div className="font-display text-2xl font-semibold">{(value * 100).toFixed(0)}%</div><div className="text-sm">{label}</div><div className="text-xs text-flw-mute">{sub}</div></div>
      </div>
    </Glass>
  );
}

export default function Pulse() {
  const [days, setDays] = useState(7);
  const calls = useMemo(() => inRange(CALLS, addDays(DEMO_TODAY, -(days - 1)), DEMO_TODAY), [days]);
  const m = useMemo(() => computeMetrics(calls), [calls]);
  const series = useMemo(() => dailySeries(CALLS, addDays(DEMO_TODAY, -(days - 1)), DEMO_TODAY).map((d) => ({ ...d, label: dayShort(d.date) })), [days]);
  const [lane] = useReplay(1, 1.4);
  const agent = usePreview((st) => st.draft.persona.agentName);
  const knowledge = usePreview((st) => st.knowledge);
  const prev = useMemo(() => computeMetrics(inRange(CALLS, addDays(DEMO_TODAY, -(2 * days - 1)), addDays(DEMO_TODAY, -days))), [days]);
  // Items that need a human decision: messages, failed calls and unverified knowledge.
  const attention = [
    ...CALLS.filter((c) => c.date >= addDays(DEMO_TODAY, -2) && (c.outcome === "message_taken" || c.outcome === "failed")).slice(0, 4).map((c) => ({ key: c.id, href: `/flow/app/calls/${c.id}`, title: c.outcome === "failed" ? `Unfinished call · ${c.callerName}` : `Callback requested · ${c.callerName}`, sub: c.summary, tone: c.outcome === "failed" ? "pink" : "lime" } as const)),
    ...knowledge.filter((k) => k.status !== "verified").map((k) => ({ key: k.id, href: "/flow/app/knowledge", title: k.status === "conflict" ? `Conflicting fact · ${k.title}` : `Unverified fact · ${k.title}`, sub: k.conflictNote ?? "Not spoken by the agent until verified.", tone: "amber" } as const)),
  ];
  // Intent → outcome routing table: where conversations actually ended up.
  const routes = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calls) map.set(`${c.intent}|${c.outcome}`, (map.get(`${c.intent}|${c.outcome}`) ?? 0) + 1);
    return [...map.entries()].map(([k, n]) => { const [i, o] = k.split("|"); return { intent: i as Intent, outcome: o as CallOutcome, n }; }).sort((a, b) => b.n - a.n).slice(0, 9);
  }, [calls]);
  const maxRoute = routes[0]?.n ?? 1;

  return (
    <>
      <Heading kicker="Pulse" title="Your receptionist, right now">
        {[7, 14, 28].map((d) => <button key={d} onClick={() => setDays(d)} className={clsx("rounded-xl px-3 py-1.5 font-mono text-xs", d === days ? "bg-flw-violet/25 text-flw-violet" : "text-flw-mute hover:text-flw-text")}>{d}d</button>)}
        <Chip tone="amber">synthetic records</Chip>
      </Heading>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Glass glow="violet" className="overflow-hidden">
          <div className="grid grid-cols-1 items-center gap-6 p-6 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto"><Orb level={lane.current?.speaker === "agent" ? 0.9 : lane.current?.speaker === "caller" ? 0.5 : 0.15} size={130} /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><Chip tone="cyan">replaying</Chip><span className="truncate text-sm text-flw-mute">{lane.call.callerName} · {INTENT_LABEL[lane.call.intent]}</span></div>
              <motion.p key={lane.current?.at} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 line-clamp-3 font-display text-xl leading-snug">
                {lane.current?.speaker === "tool" ? <span className="text-flw-cyan">⚙ {lane.current.tool?.name} → {lane.current.tool?.result}</span> : lane.current?.text ?? "…"}
              </motion.p>
              <p className="mt-3 font-mono text-[10px] text-flw-mute">A recorded demo call replayed on a loop — illustrates the live view, not a live call.</p>
            </div>
          </div>
        </Glass>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Ring value={m.answerRate} label="Answered" sub={`${m.answered} of ${m.total} calls`} color="103 232 249" />
          <Ring value={m.bookingConversion} label="Enquiries → booked" sub={`${m.booked} bookings`} color="167 139 250" />
          <Glass className="p-4"><div className="text-xs text-flw-mute">Hand-offs</div><div className="font-display text-3xl font-semibold text-flw-lime">{m.transferred + m.messages}</div><div className="text-xs text-flw-mute">{m.transferred} transfers · {m.messages} messages</div></Glass>
          <Glass className="p-4"><div className="text-xs text-flw-mute">Cost per booking (est.)</div><div className="font-display text-3xl font-semibold">{gbp(m.costPerBookingGBP)}</div><div className="text-xs text-flw-mute">p50 latency {m.latencyP50Ms}ms (simulated)</div></Glass>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Glass className="p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-flw-cyan">Summary · last {days} days</div>
          <p className="mt-3 font-display text-2xl leading-snug">
            {agent} answered <span className="text-flw-cyan">{m.answered} calls</span> and booked <span className="text-flw-violet">{m.booked} appointments</span> — {Math.abs(m.booked - prev.booked)} {m.booked >= prev.booked ? "more" : "fewer"} than the previous {days} days. {m.transferred} callers were handed to the team.
          </p>
          <p className="mt-3 text-xs text-flw-mute">Calculated from demo call records, not live calls.</p>
        </Glass>
        <Glass>
          <GHead title="Needs your attention" right={<Chip tone="amber">{attention.length}</Chip>} />
          <ul className="max-h-64 overflow-y-auto">
            {attention.map((a) => (
              <li key={a.key}><Link href={a.href} className="flex items-start gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0 hover:bg-flw-surface/60">
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.tone === "pink" ? "bg-flw-pink" : a.tone === "lime" ? "bg-flw-lime" : "bg-flw-amber")} />
                <div className="min-w-0"><div className="text-sm">{a.title}</div><div className="line-clamp-1 text-xs text-flw-mute">{a.sub}</div></div>
              </Link></li>
            ))}
          </ul>
        </Glass>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <Glass>
          <GHead title="Where conversations flowed" right={<Link href="/flow/app/canvas" className="text-xs text-flw-cyan">open canvas →</Link>} />
          <ul className="space-y-2.5 p-4">
            {routes.map((r) => (
              <li key={r.intent + r.outcome}>
                <Link href={`/flow/app/calls?intent=${r.intent}&outcome=${r.outcome}`} className="group block">
                  <div className="flex items-center gap-2 text-sm"><span className="text-flw-violet">{INTENT_LABEL[r.intent]}</span><span className="text-flw-mute">→</span><span className="text-flw-cyan">{OUTCOME_LABEL[r.outcome]}</span><span className="ml-auto font-mono text-xs text-flw-mute group-hover:text-flw-text">{r.n}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-flw-line/60"><motion.div initial={{ width: 0 }} animate={{ width: `${(r.n / maxRoute) * 100}%` }} className="h-full rounded-full bg-gradient-to-r from-flw-violet to-flw-cyan" /></div>
                </Link>
              </li>
            ))}
          </ul>
        </Glass>
        <Glass>
          <GHead title="Daily calls & bookings" />
          <div className="h-72 p-4">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ left: -10, right: 4 }}>
                <XAxis dataKey="label" stroke="rgb(150 146 180)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <Tooltip contentStyle={{ background: "rgb(22 20 38)", border: "1px solid rgb(44 40 70)", borderRadius: 12, fontSize: 12 }} cursor={{ fill: "rgb(44 40 70 / .4)" }} />
                <Bar dataKey="calls" name="Calls" fill="rgb(167 139 250)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="booked" name="Booked" fill="rgb(103 232 249)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Glass>
      </div>
    </>
  );
}
