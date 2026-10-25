"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { finput, Glass, Orb } from "@/components/flow/ui";
import { ApiError } from "@/lib/live/api";
import { useSession } from "@/lib/live/session";

function Enter() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const safeNext = next && next.startsWith("/flow/") ? next : "/flow/app";
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<"in" | "up">(sp.get("mode") === "signup" ? "up" : "in");
  const [f, setF] = useState({ email: sp.get("email") ?? "", password: "", full_name: "", organization_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "in") await signIn(f.email, f.password);
      else await signUp(f);
      router.push(safeNext);
    } catch (x) {
      setErr(x instanceof ApiError ? (x.status >= 500 || x.status === 0 ? "The VOXERA API isn't reachable. Is it running?" : x.detail) : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="flw-aurora pointer-events-none absolute inset-0" />
      <Glass className="relative z-10 w-full max-w-sm p-7" glow="violet">
        <div className="flex justify-center"><Orb level={0.4} size={84} /></div>
        <div className="mt-5 grid grid-cols-2 rounded-xl border border-flw-line p-1 text-sm" role="tablist">
          {(["in", "up"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }} className={clsx("rounded-lg py-1.5", mode === m ? "bg-flw-violet/25 text-flw-text" : "text-flw-mute")}>{m === "in" ? "Sign in" : "Create workspace"}</button>
          ))}
        </div>
        <form className="mt-5 space-y-3" onSubmit={submit}>
          {mode === "up" && <>
            <input aria-label="Your name" required className={finput} placeholder="Your name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
            <input aria-label="Business name" required className={finput} placeholder="Business name" value={f.organization_name} onChange={(e) => setF({ ...f, organization_name: e.target.value })} />
          </>}
          <input aria-label="Email" type="email" required autoComplete="email" className={finput} placeholder="Work email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input aria-label="Password" type="password" required minLength={mode === "up" ? 12 : 1} autoComplete={mode === "up" ? "new-password" : "current-password"} className={finput} placeholder={mode === "up" ? "Password (12+ characters)" : "Password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {err && <p role="alert" className="text-sm text-flw-pink">{err}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-flw-violet to-flw-cyan py-2.5 font-medium text-flw-bg disabled:opacity-50">{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create workspace"}</button>
          <button type="button" disabled title="Planned" className="w-full rounded-xl border border-flw-line py-2.5 text-sm text-flw-mute opacity-60">SSO (planned)</button>
        </form>
        <div className="mt-5 border-t border-flw-line/70 pt-4 text-center text-xs text-flw-mute">
          <Link href="/flow/app" className="text-flw-cyan hover:underline">Explore with demo data instead</Link>
          <p className="mt-2">Demo pages use synthetic records. Your workspace data is stored by the VOXERA API.</p>
          <p className="mt-2"><Link href="/flow">← back</Link></p>
        </div>
      </Glass>
    </div>
  );
}

export default function Page() {
  return <Suspense><Enter /></Suspense>;
}
