"use client";

import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Glass({ children, className, glow }: { children: ReactNode; className?: string; glow?: "violet" | "cyan" }) {
  return <section className={clsx("min-w-0 rounded-2xl border border-flw-line/80 bg-flw-glass/60 backdrop-blur-xl", glow === "violet" && "flw-glow", glow === "cyan" && "flw-glow-cyan", className)}>{children}</section>;
}

export function GHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-flw-line/70 px-4 py-3"><h2 className="font-display text-sm font-medium text-flw-text">{title}</h2>{right}</div>;
}

export function FBtn({ variant = "ghost", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "glow" | "ghost" }) {
  return (
    <button {...p} className={clsx("inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-40",
      variant === "glow" && "bg-gradient-to-r from-flw-violet to-flw-cyan text-flw-bg shadow-[0_0_24px_-4px_rgb(var(--flw-violet)/.8)] hover:brightness-110",
      variant === "ghost" && "border border-flw-line bg-flw-surface/60 text-flw-text hover:border-flw-violet/60", className)} />
  );
}

export const finput = "w-full rounded-xl border border-flw-line bg-flw-bg/70 px-3 py-2 text-sm text-flw-text placeholder:text-flw-mute/60 focus:border-flw-cyan focus:outline-none";

export function Chip({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "violet" | "cyan" | "pink" | "lime" | "amber" }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", {
    mute: "bg-flw-line/50 text-flw-mute", violet: "bg-flw-violet/15 text-flw-violet", cyan: "bg-flw-cyan/15 text-flw-cyan", pink: "bg-flw-pink/15 text-flw-pink", lime: "bg-flw-lime/15 text-flw-lime", amber: "bg-flw-amber/15 text-flw-amber",
  }[tone])}>{children}</span>;
}

export function Heading({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><div className="font-mono text-[11px] uppercase tracking-[0.3em] text-flw-cyan">{kicker}</div><h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1></div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function FSwitch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx("relative h-5 w-9 shrink-0 rounded-full transition", on ? "bg-flw-cyan/70" : "bg-flw-line")}>
      <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-flw-text transition", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/** Animated orb that reacts to (simulated) voice activity. */
export function Orb({ level, size = 120 }: { level: number; size?: number }) {
  const s = 1 + level * 0.18;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-flw-violet via-flw-pink to-flw-cyan opacity-60 blur-2xl transition-transform duration-150" style={{ transform: `scale(${s * 1.1})` }} />
      <div className="absolute inset-[14%] rounded-full bg-gradient-to-br from-flw-violet to-flw-cyan transition-transform duration-100" style={{ transform: `scale(${s})` }} />
      <div className="absolute inset-[30%] rounded-full bg-flw-bg/40 backdrop-blur" />
    </div>
  );
}
