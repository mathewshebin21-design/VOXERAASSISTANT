"use client";

import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FlowCanvas } from "@/components/flow/canvas";
import { Orb } from "@/components/flow/ui";

const PATH = ["greet", "intent", "book", "slots", "details", "confirm", "booked", "end"];

export default function Landing() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % (PATH.length + 2)), 1100); return () => clearInterval(t); }, []);
  const step = Math.min(i, PATH.length - 1);
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="flw-aurora pointer-events-none absolute inset-0" />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <span className="font-display font-semibold tracking-wide">VOXERA <span className="bg-gradient-to-r from-flw-violet to-flw-cyan bg-clip-text text-transparent">FLOW</span></span>
        <nav className="flex items-center gap-4 text-sm"><Link href="/" className="hidden text-flw-mute hover:text-flw-text sm:inline">All designs</Link><Link href="/flow/enter" className="rounded-xl border border-flw-line px-4 py-2 hover:border-flw-violet">Sign in</Link></nav>
      </header>
      <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-6 pt-8 lg:grid-cols-[1fr_auto]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-flw-violet/40 bg-flw-violet/10 px-3 py-1 text-xs text-flw-violet"><Sparkles size={12} /> Design preview C · simulated demo</span>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-6 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
            Design how your <br />AI receptionist <span className="bg-gradient-to-r from-flw-violet via-flw-pink to-flw-cyan bg-clip-text text-transparent">thinks.</span>
          </motion.h1>
          <p className="mt-6 max-w-xl text-lg text-flw-mute">A visual studio for conversations, tools, knowledge and hand-offs. Watch each call move through your flow — every tool call, every guardrail, in real time.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/flow/enter" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-flw-violet to-flw-cyan px-5 py-3 font-medium text-flw-bg">Open the studio <ArrowRight size={16} /></Link>
            <Link href="/flow/app/simulate" className="inline-flex items-center gap-2 rounded-xl border border-flw-line px-5 py-3 hover:border-flw-cyan">Run a simulation</Link>
          </div>
        </div>
        <div className="hidden lg:block"><Orb level={i % 2 ? 0.9 : 0.3} size={220} /></div>
      </section>
      <section className="relative z-10 mx-auto mt-14 max-w-7xl px-6 pb-16">
        <FlowCanvas active={PATH[step]} visited={PATH.slice(0, step + 1)} height={640} interactive={false} />
        <p className="mt-3 text-center font-mono text-[11px] text-flw-mute">Animated walkthrough of a booking path. Not a live call.</p>
      </section>
    </div>
  );
}
