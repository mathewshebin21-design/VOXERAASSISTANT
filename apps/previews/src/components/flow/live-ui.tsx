"use client";

import Link from "next/link";
import { Glass } from "./ui";

export function NeedsSignIn({ what }: { what: string }) {
  return (
    <Glass className="p-8 text-center" glow="violet">
      <div className="font-display text-xl font-semibold">Sign in to manage {what}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-flw-mute">This section stores real data through the VOXERA API. Create a free workspace, or sign in to an existing one.</p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href="/flow/enter?mode=signup" className="rounded-xl bg-gradient-to-r from-flw-violet to-flw-cyan px-4 py-2 text-sm font-medium text-flw-bg">Create workspace</Link>
        <Link href="/flow/enter" className="rounded-xl border border-flw-line px-4 py-2 text-sm">Sign in</Link>
      </div>
    </Glass>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const cls = kind === "error" ? "border-flw-pink/40 bg-flw-pink/5 text-flw-pink" : kind === "ok" ? "border-flw-lime/40 bg-flw-lime/5 text-flw-lime" : "border-flw-line bg-flw-surface/60 text-flw-mute";
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
