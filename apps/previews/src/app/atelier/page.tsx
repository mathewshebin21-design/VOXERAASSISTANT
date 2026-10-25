"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";

const STEPS = [
  ["I", "Tell us about your studio", "Services, hours and the way you like things done."],
  ["II", "Choose a voice", "Warm, bright or calm — and how much it says."],
  ["III", "Rehearse", "Talk to your receptionist before a single client does."],
  ["IV", "Go live", "Connect your number when you're ready. Not before."],
];

const PROMISES = [
  "Always says it's an AI receptionist",
  "Only offers times that are really free",
  "Asks before it books anything",
  "Hands over to you for anything delicate",
  "Never invents a price or a policy",
];

export default function Landing() {
  return (
    <div className="atl-grain min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-serif text-2xl">Voxera <span className="italic text-atl-champdeep">Atelier</span></span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hidden text-atl-soft hover:text-atl-ink sm:inline">All designs</Link>
          <Link href="/atelier/sign-in" className="rounded-full border border-atl-ink/20 px-4 py-2 hover:border-atl-champdeep">Sign in</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-10 sm:pt-20">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[11px] uppercase tracking-[0.3em] text-atl-champdeep">Design preview B · demo studio</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }} className="mt-6 max-w-4xl font-serif text-5xl font-medium leading-[0.98] tracking-tight sm:text-7xl lg:text-[88px]">
          A receptionist with <em className="text-atl-champdeep">impeccable</em> manners, on every call.
        </motion.h1>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <p className="max-w-xl text-lg leading-relaxed text-atl-soft">
            Atelier is the quiet studio where salon and clinic owners shape an AI receptionist — its voice, its knowledge, its judgement — without touching a line of configuration.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <Link href="/atelier/sign-in" className="inline-flex items-center gap-2 rounded-full bg-atl-ink px-6 py-3 text-atl-paper hover:bg-atl-ink/85">Enter the studio <ArrowUpRight size={16} /></Link>
            <Link href="/atelier/studio/rehearse" className="inline-flex items-center gap-2 rounded-full border border-atl-ink/20 px-6 py-3 hover:border-atl-champdeep">Hear a rehearsal</Link>
          </div>
        </div>
      </section>

      <div className="atl-rule mx-auto max-w-6xl" />

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-4">
        {STEPS.map(([n, t, d], i) => (
          <motion.div key={n} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
            <div className="font-serif text-3xl italic text-atl-champ">{n}</div>
            <div className="mt-3 font-serif text-xl">{t}</div>
            <p className="mt-2 text-sm text-atl-soft">{d}</p>
          </motion.div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid overflow-hidden rounded-[28px] bg-atl-ink text-atl-paper md:grid-cols-2">
          <div className="p-10 sm:p-14">
            <p className="text-[11px] uppercase tracking-[0.3em] text-atl-champ">House rules</p>
            <h2 className="mt-4 font-serif text-4xl leading-tight">Good service is a set of promises.</h2>
            <p className="mt-4 text-atl-paper/70">Every Atelier receptionist keeps these by design — they aren&apos;t settings you can forget to switch on.</p>
          </div>
          <ul className="space-y-4 border-t border-white/10 p-10 sm:p-14 md:border-l md:border-t-0">
            {PROMISES.map((p) => <li key={p} className="flex items-start gap-3"><Check size={18} className="mt-0.5 text-atl-champ" />{p}</li>)}
          </ul>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-atl-soft">Preview with synthetic data. No real calls, clients or integrations.</footer>
    </div>
  );
}
