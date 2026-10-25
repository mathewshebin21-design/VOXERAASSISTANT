"use client";

import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={clsx("min-w-0 rounded-[22px] border border-atl-line bg-atl-paper shadow-[0_1px_0_rgb(255_255_255),0_18px_40px_-28px_rgb(38_37_35/.35)]", className)}>{children}</As>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11px] font-medium uppercase tracking-[0.28em] text-atl-champdeep", className)}>{children}</div>;
}

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={clsx("font-serif text-4xl font-medium leading-[1.05] tracking-tight text-atl-ink sm:text-5xl", className)}>{children}</h1>;
}

export function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={clsx("font-serif text-2xl font-medium text-atl-ink", className)}>{children}</h2>;
}

export function Button({ variant = "solid", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "outline" | "quiet" }) {
  return (
    <button
      {...p}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        variant === "solid" && "bg-atl-ink text-atl-paper hover:bg-atl-ink/85",
        variant === "outline" && "border border-atl-ink/20 text-atl-ink hover:border-atl-champdeep hover:bg-atl-champ/10",
        variant === "quiet" && "px-3 text-atl-soft hover:text-atl-ink",
        className,
      )}
    />
  );
}

export const field = "w-full rounded-2xl border border-atl-line bg-atl-bg/60 px-4 py-3 text-[15px] text-atl-ink placeholder:text-atl-soft/60 focus:border-atl-champdeep focus:bg-atl-paper focus:outline-none";

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block">
      <span className="text-sm font-medium text-atl-ink">{children}</span>
      {hint && <span className="mt-0.5 block text-xs text-atl-soft">{hint}</span>}
    </label>
  );
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "champ" | "sage" | "rose" | "ink" }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", {
      plain: "bg-atl-bg text-atl-soft ring-1 ring-atl-line",
      champ: "bg-atl-champ/15 text-atl-champdeep",
      sage: "bg-atl-sage/15 text-atl-sage",
      rose: "bg-atl-rose/12 text-atl-rose",
      ink: "bg-atl-ink text-atl-paper",
    }[tone])}>{children}</span>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-atl-ink" : "bg-atl-line")}>
      <span className={clsx("absolute top-1 h-4 w-4 rounded-full bg-atl-paper shadow transition", on ? "left-6" : "left-1")} />
    </button>
  );
}

export function Range({ value, onChange, label, left, right, min = 0, max = 100, step = 1 }: { value: number; onChange: (n: number) => void; label: string; left: string; right: string; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--atl-champdeep))]" />
      <div className="mt-1 flex justify-between text-xs text-atl-soft"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 text-xs italic text-atl-soft"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-atl-champ" />{children}</p>;
}
