"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, BarChart3, Bot, BookOpen, CalendarRange, Gauge, LineChart, MessagesSquare, Plug, Search, Sparkles, Users, Waypoints, Wand2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePreview } from "@/lib/store";

export const FLOW_NAV = [
  { href: "/flow/app", label: "Pulse", icon: Gauge, exact: true, key: "1" },
  { href: "/flow/app/live", label: "Live", icon: Activity, key: "2" },
  { href: "/flow/app/insights", label: "Insights", icon: LineChart, key: "3" },
  { href: "/flow/app/calls", label: "Calls", icon: MessagesSquare, key: "4" },
  { href: "/flow/app/calendar", label: "Calendar", icon: CalendarRange, key: "5" },
  { href: "/flow/app/canvas", label: "Canvas", icon: Waypoints, key: "6" },
  { href: "/flow/app/agent", label: "Agent", icon: Bot, key: "7" },
  { href: "/flow/app/simulate", label: "Simulate", icon: Sparkles, key: "8" },
  { href: "/flow/app/knowledge", label: "Knowledge", icon: BookOpen, key: "9" },
  { href: "/flow/app/integrations", label: "Tools", icon: Plug, key: "" },
  { href: "/flow/app/team", label: "Team", icon: Users, key: "" },
  { href: "/flow/app/usage", label: "Usage", icon: BarChart3, key: "0" },
];

export function FlowShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState("");
  const on = (h: string, exact?: boolean) => (exact ? path === h : path === h || path.startsWith(h + "/"));
  const canvas = path.startsWith("/flow/app/canvas");
  const results = useMemo(() => [...FLOW_NAV, { href: "/flow/app/new", label: "New agent wizard", icon: Wand2, key: "" }].filter((n) => n.label.toLowerCase().includes(q.toLowerCase())), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "Escape") setPalette(false);
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const it = FLOW_NAV.find((i) => i.key === e.key);
        if (it) router.push(it.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  const go = (href: string) => { router.push(href); setPalette(false); setQ(""); };

  return (
    <div className="theme-flw relative min-h-screen overflow-x-hidden">
      <div className="flw-aurora pointer-events-none fixed inset-0" />
      <aside className="fixed left-4 top-1/2 z-40 hidden max-h-[calc(100vh-2rem)] -translate-y-1/2 flex-col items-center gap-1 overflow-y-auto rounded-2xl border border-flw-line/80 bg-flw-surface/70 p-2 backdrop-blur-xl no-scrollbar md:flex" aria-label="Flow navigation">
        <Link href="/flow" className="mb-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-flw-violet to-flw-cyan font-display text-sm font-bold text-flw-bg" aria-label="Voxera Flow home">V</Link>
        {FLOW_NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-label={n.label} aria-current={on(n.href, n.exact) ? "page" : undefined}
            className={clsx("group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition", on(n.href, n.exact) ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute hover:bg-flw-glass hover:text-flw-text")}>
            <n.icon size={18} />
            <span className="pointer-events-none absolute left-12 whitespace-nowrap rounded-lg bg-flw-glass px-2 py-1 text-xs text-flw-text opacity-0 transition group-hover:opacity-100">{n.label}{n.key && <kbd className="ml-2 text-flw-mute">⌥{n.key}</kbd>}</span>
          </Link>
        ))}
        <Link href="/flow/app/new" aria-label="New agent" className="mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-flw-line text-flw-cyan hover:border-flw-cyan"><Wand2 size={16} /></Link>
      </aside>
      <header className="relative z-30 flex items-center gap-3 px-5 py-4 md:pl-24">
        <span className="font-display text-sm font-semibold tracking-wide">VOXERA <span className="bg-gradient-to-r from-flw-violet to-flw-cyan bg-clip-text text-transparent">FLOW</span></span>
        <span className="hidden text-flw-mute sm:inline">/</span><span className="hidden truncate text-sm text-flw-mute sm:inline">Halden &amp; Rye · {agent}</span>
        <button onClick={() => setPalette(true)} className="ml-auto hidden items-center gap-2 rounded-xl border border-flw-line bg-flw-surface/60 px-3 py-1.5 text-xs text-flw-mute hover:border-flw-violet/60 sm:flex" aria-label="Jump to a page"><Search size={13} /> Jump to… <kbd>Ctrl K</kbd></button>
        <span className="ml-auto rounded-full border border-flw-amber/30 bg-flw-amber/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-flw-amber sm:ml-0">Demo · simulated</span>
      </header>
      <main className={clsx("relative z-10 min-w-0 pb-28 md:pb-10 md:pl-24", canvas ? "px-3 md:pr-4" : "mx-auto max-w-[1400px] px-5")}>{children}</main>
      <nav className="no-scrollbar fixed inset-x-3 bottom-3 z-40 flex gap-1 overflow-x-auto rounded-2xl border border-flw-line bg-flw-surface/90 p-1.5 backdrop-blur-xl md:hidden" aria-label="Flow navigation (mobile)">
        {FLOW_NAV.map((n) => (
          <Link key={n.href} href={n.href} className={clsx("flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px]", on(n.href, n.exact) ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute")}><n.icon size={17} />{n.label}</Link>
        ))}
      </nav>
      <AnimatePresence>
        {palette && (
          <motion.div className="fixed inset-0 z-[60] grid place-items-start bg-black/60 px-4 pt-24 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPalette(false)}>
            <motion.div role="dialog" aria-label="Jump to a page" initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()} className="flw-glow mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-flw-line bg-flw-glass">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to…" className="w-full border-b border-flw-line bg-transparent px-4 py-3 text-sm text-flw-text outline-none"
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) go(results[0].href); }} />
              <ul className="max-h-80 overflow-y-auto p-1">{results.map((r) => <li key={r.href}><button onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-flw-surface"><r.icon size={15} className="text-flw-cyan" />{r.label}</button></li>)}</ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
