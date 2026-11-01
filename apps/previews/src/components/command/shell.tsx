"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AudioLines, BookOpen, Bot, CalendarClock, CreditCard, FlaskConical, Gauge, LogIn, LogOut, Menu, PhoneCall, Plug, Search, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BUSINESS } from "@/lib/demo-data";
import { DEMO_NOW_MIN, DEMO_TODAY, fmtDate, fmtTime } from "@/lib/time";
import { useDataMode } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";
import { DemoBadge } from "../demo-badge";

/** Screens that read the signed-in workspace's real data; the rest still use the demo records. */
const LIVE_SCREENS = ["/command/ops"];
const initials = (name?: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export const CMD_NAV = [
  { group: "Operate", items: [
    { href: "/command/ops", label: "Operations", icon: Gauge, key: "1" },
    { href: "/command/live", label: "Live monitor", icon: Activity, key: "2" },
    { href: "/command/calls", label: "Calls & transcripts", icon: PhoneCall, key: "3" },
    { href: "/command/appointments", label: "Appointments", icon: CalendarClock, key: "4" },
  ]},
  { group: "Build", items: [
    { href: "/command/agents", label: "Agent config", icon: Bot, key: "5" },
    { href: "/command/knowledge", label: "Knowledge", icon: BookOpen, key: "6" },
    { href: "/command/simulator", label: "Simulator", icon: FlaskConical, key: "7" },
  ]},
  { group: "Admin", items: [
    { href: "/command/integrations", label: "Integrations", icon: Plug, key: "8" },
    { href: "/command/team", label: "Team & audit", icon: Users, key: "9" },
    { href: "/command/billing", label: "Usage & billing", icon: CreditCard, key: "0" },
  ]},
];

const flat = CMD_NAV.flatMap((g) => g.items);

export function CommandShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState(false);
  const dm = useDataMode();
  const signOut = useSession((s) => s.signOut);
  const live = dm.mode === "live";

  useEffect(() => { setOpen(false); setAccount(false); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "Escape") setPalette(false);
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const it = flat.find((i) => i.key === e.key);
        if (it) router.push(it.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const results = useMemo(() => flat.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())), [q]);

  const nav = (
    <nav className="flex h-full flex-col gap-5 px-3 py-4" aria-label="Command navigation">
      <Link href="/command" className="flex items-center gap-2 px-2">
        <span className="grid h-7 w-7 place-items-center rounded bg-cmd-violet/20 text-cmd-violet"><AudioLines size={16} /></span>
        <span className="font-mono text-sm font-semibold tracking-[0.2em]">VOXERA<span className="text-cmd-violet">/</span>CMD</span>
      </Link>
      <div className="rounded-md border border-cmd-line bg-cmd-bg px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute">Workspace</div>
        <div className="truncate text-sm font-medium" data-testid="cmd-workspace">{live ? dm.org!.organization.name : BUSINESS.name}</div>
        <div className="truncate text-xs text-cmd-mute">{live ? `Your workspace · ${dm.org!.role}` : `Demo workspace · ${BUSINESS.tagline}`}</div>
      </div>
      {CMD_NAV.map((g) => (
        <div key={g.group}>
          <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cmd-mute/70">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = path === it.href || path.startsWith(it.href + "/");
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link href={it.href} aria-current={active ? "page" : undefined}
                    className={clsx("group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition", active ? "bg-cmd-violet/15 text-cmd-text" : "text-cmd-mute hover:bg-cmd-raised hover:text-cmd-text")}>
                    <Icon size={15} className={active ? "text-cmd-violet" : ""} />
                    <span className="flex-1">{it.label}</span>
                    <kbd className="hidden font-mono text-[10px] text-cmd-mute/60 lg:inline">⌥{it.key}</kbd>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-auto space-y-2 px-2 text-xs text-cmd-mute">
        {live ? <>
          <DemoBadge className="bg-cmd-ok/10 text-cmd-ok">Live workspace</DemoBadge>
          <p>Operations shows your real data. No phone line is connected yet, so there are no calls.</p>
        </> : <>
          <DemoBadge className="bg-cmd-warn/10 text-cmd-warn">Simulation mode</DemoBadge>
          <p>No live telephony connected. All calls and metrics are synthetic.</p>
        </>}
      </div>
    </nav>
  );

  return (
    <div className="theme-cmd min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-cmd-line bg-cmd-panel lg:block">{nav}</aside>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-cmd-line bg-cmd-panel lg:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}>
              <button className="absolute right-3 top-3 p-1 text-cmd-mute" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
              {nav}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-cmd-line bg-cmd-bg/85 px-4 backdrop-blur">
          <button className="p-1 text-cmd-mute lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <button onClick={() => setPalette(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-cmd-line bg-cmd-panel px-3 py-1.5 text-left text-sm text-cmd-mute hover:border-cmd-violet/50 sm:max-w-sm">
            <Search size={14} /> <span className="truncate">Jump to…</span> <kbd className="ml-auto hidden font-mono text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-cmd-mute">
            {live
              ? <span className="flex items-center gap-1.5 text-cmd-ok" title="Real workspace data"><span className="h-1.5 w-1.5 rounded-full bg-cmd-ok" />LIVE</span>
              : <span className="flex items-center gap-1.5 text-cmd-warn" title="Simulation mode: synthetic demo data"><span className="h-1.5 w-1.5 rounded-full bg-cmd-warn cmd-blink" />DEMO · SIM</span>}
            {!live && <span className="hidden sm:inline">{fmtDate(DEMO_TODAY)} · {fmtTime(DEMO_NOW_MIN)} BST</span>}
            <div className="relative">
              <button onClick={() => setAccount(!account)} aria-haspopup="menu" aria-expanded={account} aria-label="Account menu" className="grid h-7 w-7 place-items-center rounded-full bg-cmd-raised text-[11px] text-cmd-text hover:ring-1 hover:ring-cmd-violet">{dm.signedIn ? initials(dm.user?.full_name) : "AO"}</button>
              {account && (
                <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-cmd-line bg-cmd-panel p-1 font-sans text-sm text-cmd-text shadow-2xl">
                  {dm.signedIn ? <>
                    <div className="px-3 py-2 text-xs text-cmd-mute">Signed in as <span className="text-cmd-text">{dm.user?.email}</span></div>
                    {dm.viewingDemo
                      ? <button role="menuitem" onClick={() => { dm.backToWorkspace(); router.push("/command/ops"); }} className="w-full rounded px-3 py-2 text-left hover:bg-cmd-raised">Back to {dm.org?.organization.name ?? "my workspace"}</button>
                      : <button role="menuitem" onClick={() => { dm.exploreDemo(); setAccount(false); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-cmd-raised"><FlaskConical size={14} /> Explore with demo data</button>}
                    <button role="menuitem" onClick={async () => { await signOut(); router.push("/command/login"); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-cmd-raised"><LogOut size={14} /> Sign out</button>
                  </> : (
                    <Link role="menuitem" href="/command/login" className="flex items-center gap-2 rounded px-3 py-2 hover:bg-cmd-raised"><LogIn size={14} /> Sign in or create a workspace</Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto min-w-0 max-w-[1400px] p-4 sm:p-6">
          {dm.viewingDemo && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-cmd-warn/40 bg-cmd-warn/10 px-3 py-2 text-sm text-cmd-warn" role="status">
              You&apos;re exploring demo data. <button onClick={() => dm.backToWorkspace()} className="underline">Back to {dm.org?.organization.name ?? "your workspace"}</button>
            </div>
          )}
          {live && !LIVE_SCREENS.some((p) => path.startsWith(p)) && (
            <div className="mb-4 rounded-md border border-cmd-line bg-cmd-raised px-3 py-2 text-sm text-cmd-mute" role="status" data-testid="cmd-demo-screen">
              Signed in to <b className="text-cmd-text">{dm.org!.organization.name}</b>. This screen still shows <b className="text-cmd-warn">demo data</b>; <Link href="/command/ops" className="text-cmd-violet hover:underline">Operations</Link> shows your real workspace.
            </div>
          )}
          {children}
        </main>
      </div>
      <AnimatePresence>
        {palette && (
          <motion.div className="fixed inset-0 z-[60] grid place-items-start bg-black/60 px-4 pt-24" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPalette(false)}>
            <motion.div role="dialog" aria-label="Command palette" className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-cmd-line bg-cmd-panel shadow-2xl" initial={{ y: -10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a screen name…" className="w-full border-b border-cmd-line bg-transparent px-4 py-3 text-sm outline-none"
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { router.push(results[0].href); setPalette(false); setQ(""); } }} />
              <ul className="max-h-80 overflow-y-auto p-1">
                {results.map((r) => (
                  <li key={r.href}>
                    <button className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-cmd-raised" onClick={() => { router.push(r.href); setPalette(false); setQ(""); }}>
                      <r.icon size={15} className="text-cmd-violet" /> {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
