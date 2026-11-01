"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import { ChevronDown, Headset, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Chip, Glass, GHead, Heading, Orb } from "@/components/flow/ui";
import { DASHBOARDS, dashboardById, dashboardFor, sectorFor, type DashboardId, type DashboardTemplate, type KpiId, type WidgetId } from "@/lib/dashboards";
import { CALLS } from "@/lib/demo-data";
import { api, PERMS, type BusinessProfile, type DeskCase, type DeskMember } from "@/lib/live/api";
import { useActiveOrg, useApi } from "@/lib/live/session";
import { computeMetrics, dailySeries, inRange, INTENT_LABEL, OUTCOME_LABEL } from "@/lib/metrics";
import { usePreview } from "@/lib/store";
import { DEMO_TODAY, addDays, dayShort, gbp } from "@/lib/time";
import type { CallOutcome, CallRecord, Intent } from "@/lib/types";
import { useReplay } from "@/lib/use-replay";

const TIP = { background: "rgb(22 20 38)", border: "1px solid rgb(44 40 70)", borderRadius: 12, fontSize: 12 };

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

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone?: string }) {
  return <Glass className="p-4"><div className="text-xs text-flw-mute">{label}</div><div className={clsx("font-display text-3xl font-semibold", tone)}>{value}</div><div className="text-xs text-flw-mute">{sub}</div></Glass>;
}

const afterHours = (c: CallRecord) => c.timeMin < 9 * 60 || c.timeMin >= 18 * 60;

/** Picks the dashboard: a signed-in workspace's sector, otherwise the demo choice. */
function useDashboard(): { tpl: DashboardTemplate; chosen: boolean; choose: (id: DashboardId) => Promise<void>; saveNote: string | null } {
  const active = useActiveOrg();
  const base = active ? `/orgs/${active.organization.id}` : null;
  const profile = useApi<BusinessProfile>(base ? `${base}/business-profile` : null);
  const local = usePreview((s) => s.dashboard);
  const setLocal = usePreview((s) => s.setDashboard);
  const canWrite = !!active && PERMS[active.role].write;
  const tpl = profile.data ? dashboardFor(profile.data.sector) : dashboardById(local) ?? DASHBOARDS[0];
  const choose = async (id: DashboardId) => {
    setLocal(id);
    if (base && canWrite && profile.data) {
      const updated = await api<BusinessProfile>(`${base}/business-profile`, { method: "PUT", body: { ...profile.data, sector: sectorFor(id) } });
      profile.setData(updated);
    }
  };
  const saveNote = active && !canWrite ? "Only owners and admins can change the workspace’s business type; this choice applies on this device." : null;
  return { tpl: active && profile.data && !canWrite && local ? dashboardById(local)! : tpl, chosen: !!profile.data || !!local, choose, saveNote };
}

function Picker({ tpl, choose, note, onDone }: { tpl: DashboardTemplate; choose: (id: DashboardId) => Promise<void>; note: string | null; onDone: () => void }) {
  return (
    <Glass glow="cyan" className="mb-4">
      <GHead title={<span className="flex items-center gap-2"><LayoutDashboard size={14} /> Choose the dashboard that fits your business</span>} right={<button onClick={onDone} className="text-xs text-flw-mute hover:text-flw-text">close</button>} />
      <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Dashboard type">
        {DASHBOARDS.map((d) => (
          <button key={d.id} role="radio" aria-checked={d.id === tpl.id} onClick={() => void choose(d.id).then(onDone)} className={clsx("rounded-xl border p-3 text-left transition", d.id === tpl.id ? "border-flw-cyan bg-flw-cyan/10" : "border-flw-line hover:border-flw-violet/60")}>
            <div className="font-display text-sm font-medium">{d.label}</div>
            <div className="mt-0.5 text-[11px] text-flw-mute">{d.examples}</div>
            <div className="mt-2 text-xs">{d.focus}</div>
          </button>
        ))}
      </div>
      <p className="px-4 pb-4 text-[11px] text-flw-mute">The layout and wording change with the business type; you can switch at any time. {note}</p>
    </Glass>
  );
}

export default function Pulse() {
  const [days, setDays] = useState(7);
  const { tpl, chosen, choose, saveNote } = useDashboard();
  const [picking, setPicking] = useState(false);
  const T = tpl.terms;
  const calls = useMemo(() => inRange(CALLS, addDays(DEMO_TODAY, -(days - 1)), DEMO_TODAY), [days]);
  const m = useMemo(() => computeMetrics(calls), [calls]);
  const prev = useMemo(() => computeMetrics(inRange(CALLS, addDays(DEMO_TODAY, -(2 * days - 1)), addDays(DEMO_TODAY, -days))), [days]);
  const series = useMemo(() => dailySeries(CALLS, addDays(DEMO_TODAY, -(days - 1)), DEMO_TODAY).map((d) => ({ ...d, label: dayShort(d.date) })), [days]);
  const peak = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ label: `${i + 7}:00`, calls: calls.filter((c) => Math.floor(c.timeMin / 60) === i + 7).length })), [calls]);
  const agent = usePreview((st) => st.draft.persona.agentName);
  const knowledge = usePreview((st) => st.knowledge);
  const [lane] = useReplay(1, 1.4);
  const ooh = calls.filter((c) => c.status === "answered" && afterHours(c)).length;
  const unhappy = calls.filter((c) => c.sentiment === "negative").length;

  const attention = [
    ...CALLS.filter((c) => c.date >= addDays(DEMO_TODAY, -2) && (c.outcome === "message_taken" || c.outcome === "failed")).slice(0, 4).map((c) => ({ key: c.id, href: `/flow/app/calls/${c.id}`, title: c.outcome === "failed" ? `Unfinished call · ${c.callerName}` : `Callback requested · ${c.callerName}`, sub: c.summary, tone: c.outcome === "failed" ? "pink" : "lime" } as const)),
    ...knowledge.filter((k) => k.status !== "verified").map((k) => ({ key: k.id, href: "/flow/app/knowledge", title: k.status === "conflict" ? `Conflicting fact · ${k.title}` : `Unverified fact · ${k.title}`, sub: k.conflictNote ?? "Not spoken by the agent until verified.", tone: "amber" } as const)),
  ];
  const routes = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calls) map.set(`${c.intent}|${c.outcome}`, (map.get(`${c.intent}|${c.outcome}`) ?? 0) + 1);
    return [...map.entries()].map(([k, n]) => { const [i, o] = k.split("|"); return { intent: i as Intent, outcome: o as CallOutcome, n }; }).sort((a, b) => b.n - a.n).slice(0, 9);
  }, [calls]);
  const maxRoute = routes[0]?.n ?? 1;

  const kpi: Record<KpiId, ReactNode> = {
    answered: <Ring key="answered" value={m.answerRate} label="Answered" sub={`${m.answered} of ${m.total} calls`} color="103 232 249" />,
    conversion: <Ring key="conversion" value={m.bookingConversion} label={`Enquiries → ${T.book}`} sub={`${m.booked} ${T.bookings}`} color="167 139 250" />,
    booked: <Stat key="booked" label={`${T.bookings[0].toUpperCase()}${T.bookings.slice(1)} ${T.book}`} value={m.booked} sub={`${m.booked >= prev.booked ? "+" : "−"}${Math.abs(m.booked - prev.booked)} vs previous ${days} days`} tone="text-flw-violet" />,
    handoffs: <Stat key="handoffs" label="Handed to the team" value={m.transferred + m.messages} sub={`${m.transferred} transfers · ${m.messages} messages`} tone="text-flw-lime" />,
    messages: <Stat key="messages" label="Callbacks owed" value={m.messages} sub={`messages for the team to return`} tone="text-flw-amber" />,
    cost: <Stat key="cost" label={`Cost per ${T.booking} (est.)`} value={gbp(m.costPerBookingGBP)} sub={`p50 latency ${m.latencyP50Ms}ms (simulated)`} />,
    unhappy: <Stat key="unhappy" label={`Unhappy ${T.customers}`} value={unhappy} sub="calls with negative sentiment" tone="text-flw-pink" />,
    afterHours: <Stat key="afterHours" label="Out-of-hours calls answered" value={ooh} sub="before 9am or after 6pm" tone="text-flw-cyan" />,
  };

  const widget: Record<WidgetId, ReactNode> = {
    live: (
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
    ),
    kpis: <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{tpl.kpis.map((k) => kpi[k])}</div>,
    summary: (
      <Glass className="p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-flw-cyan">Summary · last {days} days</div>
        <p className="mt-3 font-display text-2xl leading-snug">
          {agent} answered <span className="text-flw-cyan">{m.answered} calls</span> and {T.book} <span className="text-flw-violet">{m.booked} {T.bookings}</span> — {Math.abs(m.booked - prev.booked)} {m.booked >= prev.booked ? "more" : "fewer"} than the previous {days} days. {m.transferred} {m.transferred === 1 ? T.customer : T.customers} were handed to the team.
        </p>
        <p className="mt-3 text-xs text-flw-mute">Calculated from demo call records, not live calls.</p>
      </Glass>
    ),
    attention: (
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
    ),
    desk: <DeskSnapshot />,
    flows: (
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
    ),
    daily: (
      <Glass>
        <GHead title={`Daily calls & ${T.bookings}`} />
        <div className="h-72 p-4">
          <ResponsiveContainer>
            <BarChart data={series} margin={{ left: -10, right: 4 }}>
              <XAxis dataKey="label" stroke="rgb(150 146 180)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <Tooltip contentStyle={TIP} cursor={{ fill: "rgb(44 40 70 / .4)" }} />
              <Bar dataKey="calls" name="Calls" fill="rgb(167 139 250)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="booked" name={T.bookings[0].toUpperCase() + T.bookings.slice(1)} fill="rgb(103 232 249)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Glass>
    ),
    peak: (
      <Glass>
        <GHead title="When the phone rings" right={<span className="text-xs text-flw-mute">calls by hour · last {days} days</span>} />
        <div className="h-72 p-4" data-testid="peak-hours">
          <ResponsiveContainer>
            <BarChart data={peak} margin={{ left: -10, right: 4 }}>
              <XAxis dataKey="label" stroke="rgb(150 146 180)" fontSize={10} tickLine={false} axisLine={false} interval={1} />
              <Tooltip contentStyle={TIP} cursor={{ fill: "rgb(44 40 70 / .4)" }} />
              <Bar dataKey="calls" name="Calls" fill="rgb(103 232 249)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Glass>
    ),
    sentiment: (
      <Glass>
        <GHead title={`How ${T.customers} felt`} />
        <div className="space-y-3 p-4">
          {(["positive", "neutral", "negative"] as const).map((s) => {
            const n = calls.filter((c) => c.sentiment === s).length;
            return (
              <div key={s}>
                <div className="flex justify-between text-sm capitalize"><span>{s}</span><span className="font-mono text-xs text-flw-mute">{n}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-flw-line/60"><div className={clsx("h-full rounded-full", s === "positive" ? "bg-flw-lime" : s === "neutral" ? "bg-flw-cyan" : "bg-flw-pink")} style={{ width: `${calls.length ? (n / calls.length) * 100 : 0}%` }} /></div>
              </div>
            );
          })}
          <p className="text-[11px] text-flw-mute">Estimated from demo transcripts.</p>
        </div>
      </Glass>
    ),
  };

  const rows: WidgetId[][] = [];
  for (let i = 0; i < tpl.widgets.length; i += 2) rows.push(tpl.widgets.slice(i, i + 2));

  return (
    <>
      <Heading kicker={`Pulse · ${tpl.label}`} title="Your receptionist, right now">
        <button onClick={() => setPicking(!picking)} aria-expanded={picking} className="flex items-center gap-1.5 rounded-xl border border-flw-line bg-flw-surface/60 px-3 py-1.5 text-xs hover:border-flw-violet/60" data-testid="dashboard-picker"><LayoutDashboard size={13} /> {tpl.label} <ChevronDown size={12} /></button>
        {[7, 14, 28].map((d) => <button key={d} onClick={() => setDays(d)} className={clsx("rounded-xl px-3 py-1.5 font-mono text-xs", d === days ? "bg-flw-violet/25 text-flw-violet" : "text-flw-mute hover:text-flw-text")}>{d}d</button>)}
        <Chip tone="amber">synthetic records</Chip>
      </Heading>
      {(picking || !chosen) && <Picker tpl={tpl} choose={choose} note={saveNote} onDone={() => setPicking(false)} />}
      <div className="space-y-4">
        {rows.map((r, i) => (
          <div key={r.join("-")} className={clsx("grid grid-cols-1 gap-4", r.length === 2 && (i === 0 ? "lg:grid-cols-[1.2fr_1fr]" : "lg:grid-cols-2"))}>
            {r.map((w) => <div key={w} className="min-w-0">{widget[w]}</div>)}
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[11px] text-flw-mute">Figures come from the demo salon’s records; the layout and wording follow the business type you chose.</p>
    </>
  );
}

/** Live queue and team availability for signed-in workspaces; an explainer in demo mode. */
function DeskSnapshot() {
  const active = useActiveOrg();
  const base = active && PERMS[active.role].desk ? `/orgs/${active.organization.id}` : null;
  const team = useApi<DeskMember[]>(base ? `${base}/desk/team` : null);
  const queue = useApi<DeskCase[]>(base ? `${base}/cases?status=new` : null);
  const available = team.data?.filter((m) => m.status === "available").length ?? 0;
  return (
    <Glass>
      <GHead title={<span className="flex items-center gap-2"><Headset size={14} /> Staff desk</span>} right={<Link href="/flow/app/desk" className="text-xs text-flw-cyan">open desk →</Link>} />
      {base ? (
        <div className="grid grid-cols-2 gap-3 p-4">
          <div><div className="font-display text-3xl font-semibold text-flw-amber" data-testid="snapshot-queue">{queue.data?.length ?? "–"}</div><div className="text-xs text-flw-mute">callers waiting in the queue</div></div>
          <div><div className="font-display text-3xl font-semibold text-flw-lime">{team.data ? `${available}/${team.data.length}` : "–"}</div><div className="text-xs text-flw-mute">team members available</div></div>
          <Chip tone="lime">live data</Chip>
        </div>
      ) : (
        <p className="p-4 text-sm text-flw-mute">When the AI can’t help, it hands the caller to whoever on your team is available, and messages go to a shared queue. Sign in to a workspace to see your team’s live queue here.</p>
      )}
    </Glass>
  );
}
