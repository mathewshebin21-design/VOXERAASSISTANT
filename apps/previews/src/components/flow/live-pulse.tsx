"use client";

import { clsx } from "clsx";
import { ArrowRight, Check, ChevronDown, Circle, LayoutDashboard, PhoneOff, Rocket } from "lucide-react";
import { useState } from "react";
import { Picker, useDashboard } from "./dashboard-picker";
import Link from "next/link";
import { Chip, FBtn, Glass, GHead, Heading } from "./ui";
import { fmtIn, useWorkspaceDashboard } from "@/lib/live/dashboard";
import { useDataMode } from "@/lib/live/data-mode";

const KIND = { transfer: "Transferred call", callback: "Call back", message: "Message" } as const;

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub: string; tone?: string }) {
  return <Glass className="p-4"><div className="text-xs text-flw-mute">{label}</div><div className={clsx("font-display text-3xl font-semibold", tone)}>{value}</div><div className="text-xs text-flw-mute">{sub}</div></Glass>;
}

/** Pulse for a signed-in workspace: real data, and the setup assistant front and centre until setup is done. */
export function LivePulse({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { data: d, error } = useWorkspaceDashboard(orgId);
  const dm = useDataMode();
  const { tpl, choose, saveNote } = useDashboard();
  const [picking, setPicking] = useState(false);
  const T = tpl.terms;
  const Cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  const head = (
    <Heading kicker={`Pulse · ${orgName} · ${tpl.label}`} title="Your receptionist, right now">
      <button onClick={() => setPicking(!picking)} aria-expanded={picking} className="flex items-center gap-1.5 rounded-xl border border-flw-line bg-flw-surface/60 px-3 py-1.5 text-xs hover:border-flw-violet/60" data-testid="dashboard-picker"><LayoutDashboard size={13} /> {tpl.label} <ChevronDown size={12} /></button>
      <Chip tone="lime">your workspace</Chip>
      <button onClick={() => dm.exploreDemo()} className="rounded-xl border border-flw-line px-3 py-1.5 text-xs text-flw-mute hover:text-flw-text">Explore with demo data</button>
    </Heading>
  );
  const pick = picking && <Picker tpl={tpl} choose={choose} note={saveNote} onDone={() => setPicking(false)} />;
  if (error) return <>{head}<Glass className="p-6 text-flw-pink" glow="violet"><p role="alert">{error}</p></Glass></>;
  if (!d) return <>{head}<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-flw-surface/60" />)}</div></>;
  const tz = d.timezone;
  const setupOpen = d.setupDone < d.setup.length;

  return (
    <>
      {head}
      {pick}
      {setupOpen && (
        <Glass glow="cyan" className="mb-4">
          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex items-center gap-2 font-display text-lg font-medium"><Rocket size={18} className="text-flw-cyan" /> {d.isNew ? `Welcome! Let's set up ${orgName}` : "Finish setting up"}</div>
              <p className="mt-1 text-sm text-flw-mute">The setup assistant asks a few simple questions — what you do, your hours, your services and prices — and fills everything in for you. About five minutes.</p>
              <ul className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2" data-testid="pulse-setup">
                {d.setup.map((s) => <li key={s.id} className="flex items-center gap-2">{s.done ? <Check size={14} className="text-flw-lime" /> : <Circle size={14} className="text-flw-mute" />}<span className={s.done ? "text-flw-mute line-through" : ""}>{s.label}</span></li>)}
              </ul>
            </div>
            <Link href="/flow/app/setup"><FBtn variant="glow" className="w-full md:w-auto">Start the setup assistant <ArrowRight size={14} /></FBtn></Link>
          </div>
        </Glass>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label={`${Cap(T.bookings)} · next 7 days`} value={d.next7Days} sub={`${d.upcoming.length} upcoming in total`} tone="text-flw-violet" />
        <Tile label="Booked by your receptionist" value={d.bookedByAi} sub={`of the upcoming ${T.bookings}`} tone="text-flw-cyan" />
        <Tile label="Waiting for the team" value={d.waiting.length} sub={d.urgent ? `${d.urgent} urgent` : "nothing urgent"} tone="text-flw-amber" />
        <Tile label="Team available" value={`${d.teamAvailable}/${d.teamOnDesk}`} sub="on the staff desk" tone="text-flw-lime" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Glass>
          <GHead title={`Upcoming ${T.bookings}`} right={<span className="font-mono text-[10px] text-flw-mute">{tz}</span>} />
          <ul className="divide-y divide-flw-line/60" data-testid="pulse-bookings">
            {d.upcoming.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-32 shrink-0 font-mono text-xs text-flw-mute">{fmtIn(a.starts_at, tz)}</span>
                <span className="min-w-0 flex-1 truncate">{a.customer_name} · {a.service_name}</span>
                {a.source === "ai_receptionist" && <Chip tone="cyan">AI</Chip>}
              </li>
            ))}
            {!d.upcoming.length && <li className="p-4 text-sm text-flw-mute">No {T.bookings} yet. They appear here as soon as your receptionist or your team books a {T.customer} in.</li>}
          </ul>
        </Glass>
        <Glass>
          <GHead title="Waiting on the desk" right={<Link href="/flow/app/desk" className="text-xs text-flw-cyan">open desk →</Link>} />
          <ul className="space-y-2.5 p-4">
            {d.waiting.slice(0, 5).map((c) => <li key={c.id} className="text-sm"><div className="flex items-center gap-2"><span className="font-medium">{c.caller_name ?? "Unknown caller"}</span><Chip tone={c.urgent ? "pink" : "amber"}>{c.urgent ? "urgent" : KIND[c.kind]}</Chip></div><p className="line-clamp-1 text-xs text-flw-mute">{c.summary}</p></li>)}
            {!d.waiting.length && <li className="text-sm text-flw-mute">Nobody waiting. Messages and transfers from your receptionist land here.</li>}
          </ul>
        </Glass>
      </div>
      <Glass className="mt-4 p-5">
        <div className="flex items-start gap-3"><PhoneOff size={18} className="mt-0.5 text-flw-mute" /><p className="text-sm text-flw-mute">No calls yet — call volume, outcomes and transcripts appear once a phone line is connected. Meanwhile, talk to your receptionist in the <Link href="/flow/app/voice" className="text-flw-cyan hover:underline">Voice lab</Link>.</p></div>
      </Glass>
    </>
  );
}
