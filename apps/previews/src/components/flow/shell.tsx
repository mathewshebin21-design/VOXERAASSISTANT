"use client";

import { clsx } from "clsx";
import { BarChart3, BookOpen, CalendarRange, Gauge, MessagesSquare, Plug, Sparkles, Waypoints, Wand2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePreview } from "@/lib/store";

export const FLOW_NAV = [
  { href: "/flow/app", label: "Pulse", icon: Gauge, exact: true },
  { href: "/flow/app/canvas", label: "Canvas", icon: Waypoints },
  { href: "/flow/app/simulate", label: "Simulate", icon: Sparkles },
  { href: "/flow/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/flow/app/calls", label: "Calls", icon: MessagesSquare },
  { href: "/flow/app/calendar", label: "Calendar", icon: CalendarRange },
  { href: "/flow/app/integrations", label: "Tools", icon: Plug },
  { href: "/flow/app/usage", label: "Usage", icon: BarChart3 },
];

export function FlowShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const on = (h: string, exact?: boolean) => (exact ? path === h : path === h || path.startsWith(h + "/"));
  const canvas = path.startsWith("/flow/app/canvas");
  return (
    <div className="theme-flw relative min-h-screen overflow-x-hidden">
      <div className="flw-aurora pointer-events-none fixed inset-0" />
      <aside className="fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-flw-line/80 bg-flw-surface/70 p-2 backdrop-blur-xl md:flex" aria-label="Flow navigation">
        <Link href="/flow" className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-flw-violet to-flw-cyan font-display text-sm font-bold text-flw-bg" aria-label="Voxera Flow home">V</Link>
        {FLOW_NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-label={n.label} aria-current={on(n.href, n.exact) ? "page" : undefined}
            className={clsx("group relative grid h-10 w-10 place-items-center rounded-xl transition", on(n.href, n.exact) ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute hover:bg-flw-glass hover:text-flw-text")}>
            <n.icon size={18} />
            <span className="pointer-events-none absolute left-12 whitespace-nowrap rounded-lg bg-flw-glass px-2 py-1 text-xs text-flw-text opacity-0 transition group-hover:opacity-100">{n.label}</span>
          </Link>
        ))}
        <Link href="/flow/app/new" aria-label="New agent" className="mt-2 grid h-10 w-10 place-items-center rounded-xl border border-dashed border-flw-line text-flw-cyan hover:border-flw-cyan"><Wand2 size={16} /></Link>
      </aside>
      <header className="relative z-30 flex items-center gap-3 px-5 py-4 md:pl-24">
        <span className="font-display text-sm font-semibold tracking-wide">VOXERA <span className="bg-gradient-to-r from-flw-violet to-flw-cyan bg-clip-text text-transparent">FLOW</span></span>
        <span className="hidden text-flw-mute sm:inline">/</span><span className="hidden truncate text-sm text-flw-mute sm:inline">Halden &amp; Rye · {agent}</span>
        <span className="ml-auto rounded-full border border-flw-amber/30 bg-flw-amber/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-flw-amber">Demo · simulated</span>
      </header>
      <main className={clsx("relative z-10 min-w-0 pb-28 md:pb-10 md:pl-24", canvas ? "px-3 md:pr-4" : "mx-auto max-w-[1400px] px-5")}>{children}</main>
      <nav className="no-scrollbar fixed inset-x-3 bottom-3 z-40 flex gap-1 overflow-x-auto rounded-2xl border border-flw-line bg-flw-surface/90 p-1.5 backdrop-blur-xl md:hidden" aria-label="Flow navigation (mobile)">
        {FLOW_NAV.map((n) => (
          <Link key={n.href} href={n.href} className={clsx("flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px]", on(n.href, n.exact) ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute")}><n.icon size={17} />{n.label}</Link>
        ))}
      </nav>
    </div>
  );
}
