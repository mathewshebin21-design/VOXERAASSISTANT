"use client";

import { motion } from "framer-motion";
import { ArrowRight, AudioLines, CalendarCheck, GitBranch, Headphones, ShieldCheck, Waypoints } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Waveform } from "@/components/command/waveform";
import { DemoBadge } from "@/components/demo-badge";

const LINES = [
  ["caller", "Hi, can I get a restyle on Thursday evening?"],
  ["tool", "check_availability(service=restyle, day=Thu, after=17:00) → 2 slots"],
  ["agent", "I have 5:30 with Ben or 6:15 with Ada. Restyles are from £58."],
  ["caller", "6:15 with Ada please."],
  ["agent", "To confirm: Thursday 6:15pm with Ada. Shall I book it?"],
  ["caller", "Yes."],
  ["tool", "create_booking(confirmed_by_caller=true, idempotency_key=…) → ok"],
] as const;

const FEATURES = [
  { icon: Headphones, t: "Real-time operations", d: "Live call monitor, transcripts and tool traces in one console." },
  { icon: CalendarCheck, t: "Grounded booking", d: "Availability comes from your calendar. Bookings need explicit caller confirmation." },
  { icon: ShieldCheck, t: "Guardrails by default", d: "AI disclosure, recording notices, escalation rules and refusal of unknowns." },
  { icon: GitBranch, t: "Versioned agents", d: "Test in the simulator, publish a version, roll back in one click." },
  { icon: Waypoints, t: "Integrations", d: "Google/Microsoft calendars, HubSpot, SMS, signed webhooks — planned in phases." },
  { icon: AudioLines, t: "Provider-agnostic voice", d: "Swap STT, LLM and TTS providers without changing your agent." },
];

export default function Landing() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % (LINES.length + 3)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid-bg min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="font-mono text-sm font-semibold tracking-[0.25em]">VOXERA<span className="text-cmd-violet">/</span>CMD</div>
        <nav className="flex items-center gap-2 text-sm sm:gap-4">
          <Link href="/" className="hidden text-cmd-mute hover:text-cmd-text sm:inline">All designs</Link>
          <Link href="/command/login" className="rounded-md border border-cmd-line px-3 py-1.5 hover:border-cmd-violet">Sign in</Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <div>
          <DemoBadge className="bg-cmd-violet/15 text-cmd-violet">Design preview A · demo data</DemoBadge>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            The control room for your <span className="bg-gradient-to-r from-cmd-violet to-cmd-cyan bg-clip-text text-transparent">AI receptionist</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-cmd-mute">
            VOXERA answers your business line, books appointments against your real availability and hands off to your team when it should —
            with every turn, tool call and outcome visible to operators.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/command/login" className="inline-flex items-center gap-2 rounded-md bg-cmd-violet px-5 py-2.5 font-medium text-white hover:bg-cmd-violet/85">Open console <ArrowRight size={16} /></Link>
            <Link href="/command/simulator" className="inline-flex items-center gap-2 rounded-md border border-cmd-line px-5 py-2.5 hover:border-cmd-cyan">Try the simulator</Link>
          </div>
          <p className="mt-6 text-xs text-cmd-mute">Preview only: there is no live phone line behind this page. Telephony arrives in Phase 4, after approval.</p>
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-xl border border-cmd-line bg-cmd-panel shadow-[0_0_80px_-20px_rgb(var(--cmd-violet)/.5)]">
          <div className="flex items-center justify-between border-b border-cmd-line px-4 py-2 font-mono text-[11px] text-cmd-mute">
            <span>session · simulated replay</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cmd-bad cmd-blink" />REC (demo)</span>
          </div>
          <div className="px-4 pt-3"><Waveform level={n % 2 ? 0.8 : 0.35} height={56} /></div>
          <ol className="space-y-2 p-4 font-mono text-[12.5px]">
            {LINES.slice(0, Math.min(n, LINES.length)).map(([who, text], i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
                <span className={who === "agent" ? "text-cmd-violet" : who === "tool" ? "text-cmd-cyan" : "text-cmd-mute"}>{who.padEnd(6, " ")}</span>
                <span className={who === "tool" ? "text-cmd-cyan/80" : ""}>{text}</span>
              </motion.li>
            ))}
            <li className="text-cmd-violet cmd-blink">▍</li>
          </ol>
        </motion.div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-px overflow-hidden rounded-xl border border-cmd-line bg-cmd-line px-0 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.t} className="bg-cmd-panel p-6">
            <f.icon size={18} className="text-cmd-cyan" />
            <div className="mt-3 font-medium">{f.t}</div>
            <div className="mt-1 text-sm text-cmd-mute">{f.d}</div>
          </div>
        ))}
      </section>
      <footer className="mx-auto max-w-6xl px-5 py-10 text-xs text-cmd-mute">VOXERA AI · design preview A “Command”. Synthetic data. Not a live service.</footer>
    </div>
  );
}
