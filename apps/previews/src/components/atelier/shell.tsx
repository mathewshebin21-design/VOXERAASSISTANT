"use client";

import { clsx } from "clsx";
import { BookOpenText, CalendarDays, Home, Link2, MessagesSquare, Mic2, NotebookPen, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BUSINESS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";

export const ATL_NAV = [
  { href: "/atelier/studio", label: "Today", icon: Home, exact: true },
  { href: "/atelier/studio/voice", label: "Voice", icon: Mic2 },
  { href: "/atelier/studio/knowledge", label: "Notebook", icon: NotebookPen },
  { href: "/atelier/studio/rehearse", label: "Rehearse", icon: Sparkles },
  { href: "/atelier/studio/calls", label: "Journal", icon: MessagesSquare },
  { href: "/atelier/studio/diary", label: "Diary", icon: CalendarDays },
  { href: "/atelier/studio/connections", label: "Connections", icon: Link2 },
  { href: "/atelier/studio/plan", label: "Plan", icon: Wallet },
];

const MOBILE = [ATL_NAV[0], ATL_NAV[3], ATL_NAV[4], ATL_NAV[5], ATL_NAV[1]];

export function AtelierShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <div className="theme-atl min-h-screen pb-24 lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-atl-line/80 bg-atl-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <Link href="/atelier" className="font-serif text-2xl tracking-tight">Voxera <span className="italic text-atl-champdeep">Atelier</span></Link>
          <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Studio">
            {ATL_NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href, n.exact) ? "page" : undefined}
                className={clsx("rounded-full px-3.5 py-1.5 text-sm transition", isActive(n.href, n.exact) ? "bg-atl-ink text-atl-paper" : "text-atl-soft hover:text-atl-ink")}>{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <span className="rounded-full bg-atl-champ/15 px-2.5 py-1 text-[11px] font-medium text-atl-champdeep" title="Synthetic data, simulated calls">Demo studio</span>
            <div className="hidden text-right text-xs sm:block"><div className="font-medium">{BUSINESS.name}</div><div className="text-atl-soft">with {agent}</div></div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-atl-ink font-serif text-sm text-atl-paper">AO</span>
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-5 pb-2 lg:hidden" aria-label="All studio sections">
          {ATL_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("whitespace-nowrap rounded-full px-3 py-1 text-xs", isActive(n.href, n.exact) ? "bg-atl-ink text-atl-paper" : "text-atl-soft ring-1 ring-atl-line")}>{n.label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-7xl px-5 py-8 sm:py-12">{children}</main>
      <footer className="mx-auto hidden max-w-7xl items-center justify-between px-5 pb-10 text-xs text-atl-soft lg:flex">
        <span>Voxera Atelier — design preview B. Demo data only; no live phone line is connected.</span>
        <Link href="/atelier/studio/create" className="inline-flex items-center gap-1 hover:text-atl-ink"><BookOpenText size={13} /> Set up a new receptionist</Link>
      </footer>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-full border border-atl-line bg-atl-paper/95 px-2 py-1.5 shadow-lg backdrop-blur lg:hidden" aria-label="Studio (mobile)">
        {MOBILE.map((n) => (
          <Link key={n.href} href={n.href} className={clsx("flex flex-col items-center gap-0.5 rounded-full px-3 py-1 text-[10px]", isActive(n.href, n.exact) ? "text-atl-ink" : "text-atl-soft")}>
            <n.icon size={18} strokeWidth={isActive(n.href, n.exact) ? 2.2 : 1.6} />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
