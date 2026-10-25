"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, BookOpenText, CalendarDays, Home, LineChart, Link2, MessagesSquare, Mic2, NotebookPen, Search, Sparkles, Users, Waypoints, Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BUSINESS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";

// Three rooms of the studio. Every Command (A) and Flow (C) capability has a home here.
export const ATL_GROUPS = [
  { name: "Front desk", items: [
    { href: "/atelier/studio", label: "Today", icon: Home, exact: true, key: "1" },
    { href: "/atelier/studio/live", label: "Live", icon: Activity, key: "2" },
    { href: "/atelier/studio/calls", label: "Journal", icon: MessagesSquare, key: "3" },
    { href: "/atelier/studio/diary", label: "Diary", icon: CalendarDays, key: "4" },
    { href: "/atelier/studio/insights", label: "Insights", icon: LineChart, key: "5" },
  ]},
  { name: "Studio", items: [
    { href: "/atelier/studio/voice", label: "Voice & manner", icon: Mic2, key: "6" },
    { href: "/atelier/studio/flow", label: "Conversation map", icon: Waypoints, key: "7" },
    { href: "/atelier/studio/knowledge", label: "Notebook", icon: NotebookPen, key: "8" },
    { href: "/atelier/studio/rehearse", label: "Rehearse", icon: Sparkles, key: "9" },
  ]},
  { name: "House", items: [
    { href: "/atelier/studio/connections", label: "Connections", icon: Link2, key: "" },
    { href: "/atelier/studio/team", label: "Team & activity", icon: Users, key: "" },
    { href: "/atelier/studio/plan", label: "Plan & usage", icon: Wallet, key: "0" },
  ]},
];

export const ATL_NAV = ATL_GROUPS.flatMap((g) => g.items);
const MOBILE = [ATL_NAV[0], ATL_NAV[1], ATL_NAV[2], ATL_NAV[3], ATL_NAV[8]];

export function AtelierShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const [finder, setFinder] = useState(false);
  const [q, setQ] = useState("");
  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));
  const group = ATL_GROUPS.find((g) => g.items.some((i) => isActive(i.href, i.exact))) ?? ATL_GROUPS[0];
  const results = useMemo(() => ATL_NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFinder((f) => !f); }
      if (e.key === "Escape") setFinder(false);
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const it = ATL_NAV.find((i) => i.key === e.key);
        if (it) router.push(it.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const go = (href: string) => { router.push(href); setFinder(false); setQ(""); };

  return (
    <div className="theme-atl min-h-screen pb-24 lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-atl-line/80 bg-atl-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <Link href="/atelier" className="font-serif text-2xl tracking-tight">Voxera <span className="italic text-atl-champdeep">Atelier</span></Link>
          <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Studio rooms">
            {ATL_GROUPS.map((g) => (
              <Link key={g.name} href={g.items[0].href} aria-current={g === group ? "true" : undefined}
                className={clsx("rounded-full px-4 py-1.5 font-serif text-lg transition", g === group ? "text-atl-ink" : "text-atl-soft hover:text-atl-ink")}>
                {g.name}{g === group && <span className="mx-auto mt-0.5 block h-px w-6 bg-atl-champdeep" />}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <button onClick={() => setFinder(true)} className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-sm text-atl-soft ring-1 ring-atl-line hover:text-atl-ink sm:flex" aria-label="Find a page"><Search size={14} /> Find <kbd className="text-[10px]">Ctrl K</kbd></button>
            <span className="rounded-full bg-atl-champ/15 px-2.5 py-1 text-[11px] font-medium text-atl-champdeep" title="Synthetic data, simulated calls">Demo studio</span>
            <div className="hidden text-right text-xs xl:block"><div className="font-medium">{BUSINESS.name}</div><div className="text-atl-soft">with {agent}</div></div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-atl-ink font-serif text-sm text-atl-paper">AO</span>
          </div>
        </div>
        <nav className="mx-auto hidden max-w-7xl gap-1 px-5 pb-3 lg:flex" aria-label={`${group.name} sections`}>
          {group.items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href, n.exact) ? "page" : undefined}
              className={clsx("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition", isActive(n.href, n.exact) ? "bg-atl-ink text-atl-paper" : "text-atl-soft hover:text-atl-ink")}>
              <n.icon size={14} />{n.label}
            </Link>
          ))}
        </nav>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-5 pb-2 lg:hidden" aria-label="All studio sections">
          {ATL_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("whitespace-nowrap rounded-full px-3 py-1 text-xs", isActive(n.href, n.exact) ? "bg-atl-ink text-atl-paper" : "text-atl-soft ring-1 ring-atl-line")}>{n.label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-7xl px-5 py-8 sm:py-12">{children}</main>
      <footer className="mx-auto hidden max-w-7xl items-center justify-between px-5 pb-10 text-xs text-atl-soft lg:flex">
        <span>Voxera Atelier — design preview B. Demo data only; no live phone line is connected. Shortcuts: Ctrl K to find, Alt + number to jump.</span>
        <Link href="/atelier/studio/create" className="inline-flex items-center gap-1 hover:text-atl-ink"><BookOpenText size={13} /> Set up a new receptionist</Link>
      </footer>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-full border border-atl-line bg-atl-paper/95 px-2 py-1.5 shadow-lg backdrop-blur lg:hidden" aria-label="Studio (mobile)">
        {MOBILE.map((n) => (
          <Link key={n.href} href={n.href} className={clsx("flex flex-col items-center gap-0.5 rounded-full px-2 py-1 text-[10px]", isActive(n.href, n.exact) ? "text-atl-ink" : "text-atl-soft")}>
            <n.icon size={18} strokeWidth={isActive(n.href, n.exact) ? 2.2 : 1.6} />{n.label.split(" ")[0]}
          </Link>
        ))}
      </nav>
      <AnimatePresence>
        {finder && (
          <motion.div className="fixed inset-0 z-[60] grid place-items-start bg-atl-ink/30 px-4 pt-28 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFinder(false)}>
            <motion.div role="dialog" aria-label="Find a page" initial={{ y: -8 }} animate={{ y: 0 }} onClick={(e) => e.stopPropagation()} className="mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-atl-line bg-atl-paper shadow-2xl">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Where would you like to go?" className="w-full border-b border-atl-line bg-transparent px-6 py-4 font-serif text-xl outline-none"
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) go(results[0].href); }} />
              <ul className="max-h-80 overflow-y-auto p-2">
                {results.map((r) => <li key={r.href}><button onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left hover:bg-atl-bg"><r.icon size={16} className="text-atl-champdeep" />{r.label}</button></li>)}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
