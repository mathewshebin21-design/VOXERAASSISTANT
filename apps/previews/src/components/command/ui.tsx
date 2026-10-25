"use client";

import { clsx } from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, action, children, className, dense }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <section className={clsx("rounded-lg border border-cmd-line bg-cmd-panel", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-cmd-line px-4 py-2.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-cmd-mute">{title}</h2>
          {action}
        </header>
      )}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "text", href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "text" | "violet" | "cyan" | "ok" | "warn" | "bad"; href?: string }) {
  const toneCls = { text: "text-cmd-text", violet: "text-cmd-violet", cyan: "text-cmd-cyan", ok: "text-cmd-ok", warn: "text-cmd-warn", bad: "text-cmd-bad" }[tone];
  const body = (
    <div className="rounded-lg border border-cmd-line bg-cmd-panel p-4 transition hover:border-cmd-violet/50">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute">{label}</div>
      <div className={clsx("mt-2 font-mono text-2xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-cmd-mute">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} title="View the calls behind this number">{body}</Link> : body;
}

export function Tag({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "violet" | "cyan" | "ok" | "warn" | "bad" }) {
  const map = {
    mute: "border-cmd-line text-cmd-mute",
    violet: "border-cmd-violet/40 bg-cmd-violet/10 text-cmd-violet",
    cyan: "border-cmd-cyan/40 bg-cmd-cyan/10 text-cmd-cyan",
    ok: "border-cmd-ok/40 bg-cmd-ok/10 text-cmd-ok",
    warn: "border-cmd-warn/40 bg-cmd-warn/10 text-cmd-warn",
    bad: "border-cmd-bad/40 bg-cmd-bad/10 text-cmd-bad",
  } as const;
  return <span className={clsx("inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", map[tone])}>{children}</span>;
}

export function Btn({ variant = "ghost", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...p}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40",
        variant === "primary" && "bg-cmd-violet text-white hover:bg-cmd-violet/85",
        variant === "ghost" && "border border-cmd-line text-cmd-text hover:border-cmd-violet/60 hover:bg-cmd-raised",
        variant === "danger" && "border border-cmd-bad/40 text-cmd-bad hover:bg-cmd-bad/10",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-cmd-mute">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-cmd-line bg-cmd-bg px-3 py-2 text-sm text-cmd-text placeholder:text-cmd-mute/60 focus:border-cmd-violet focus:outline-none";

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--cmd-violet))]" />;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={clsx("relative h-5 w-9 rounded-full border transition", on ? "border-cmd-violet bg-cmd-violet/40" : "border-cmd-line bg-cmd-raised")}>
      <span className={clsx("absolute top-0.5 h-3.5 w-3.5 rounded-full transition", on ? "left-[18px] bg-cmd-violet" : "left-0.5 bg-cmd-mute")} />
    </button>
  );
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cmd-violet">{kicker}</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
