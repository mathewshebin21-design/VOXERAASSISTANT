"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { field } from "@/components/atelier/ui";
import { useAuthForm } from "@/lib/live/auth-form";
import { useDataMode } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";

function SignIn() {
  const router = useRouter();
  const sp = useSearchParams();
  const dm = useDataMode();
  const signOut = useSession((s) => s.signOut);
  const a = useAuthForm({ initialMode: sp.get("mode") === "signup" ? "up" : "in", onDone: () => router.push("/atelier/studio") });
  const demo = () => { dm.exploreDemo(); router.push("/atelier/studio"); };

  return (
    <div className="atl-grain grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-atl-ink p-14 text-atl-paper lg:flex">
        <span className="font-serif text-2xl">Voxera <span className="italic text-atl-champ">Atelier</span></span>
        <blockquote className="font-serif text-4xl leading-tight">“It answers the phone the way I would — if I weren&apos;t mid-balayage.”<footer className="mt-4 font-sans text-sm text-atl-paper/60">— illustrative quote, demo studio</footer></blockquote>
        <span className="text-xs text-atl-paper/50">Design preview B</span>
      </div>
      <div className="grid place-items-center px-6 py-12">
        <div className="w-full max-w-sm">
          {dm.signedIn && (
            <div className="mb-8 rounded-3xl border border-atl-line bg-atl-paper p-5 text-sm" role="status">
              You&apos;re signed in as <b>{dm.user?.email}</b>{dm.org && <> — {dm.org.organization.name}</>}.
              <div className="mt-3 flex gap-2">
                <button onClick={() => { dm.backToWorkspace(); router.push("/atelier/studio"); }} className="rounded-full bg-atl-ink px-4 py-1.5 text-atl-paper">Enter your studio</button>
                <button onClick={() => void signOut()} className="rounded-full px-4 py-1.5 ring-1 ring-atl-line">Sign out</button>
              </div>
            </div>
          )}
          <div className="flex gap-6 border-b border-atl-line" role="tablist" aria-label="Account">
            {(["in", "up"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={a.mode === m} onClick={() => a.setMode(m)} className={clsx("-mb-px border-b-2 pb-2 font-serif text-lg", a.mode === m ? "border-atl-champdeep text-atl-ink" : "border-transparent text-atl-soft hover:text-atl-ink")}>{m === "in" ? "Sign in" : "Create workspace"}</button>
            ))}
          </div>
          <h1 className="mt-8 font-serif text-4xl">{a.mode === "in" ? "Welcome back" : "Open your studio"}</h1>
          <p className="mt-2 text-sm text-atl-soft">{a.mode === "in" ? "Sign in to your own business — real bookings, real requests." : "A few details and your workspace is ready. You can invite your team afterwards."}</p>
          <form onSubmit={a.submit}>
            {a.mode === "up" && <>
              <label htmlFor="atl-name" className="mt-8 block text-sm font-medium">Your name</label>
              <input id="atl-name" required className={field + " mt-2"} value={a.f.full_name} onChange={(e) => a.setF({ ...a.f, full_name: e.target.value })} />
              <label htmlFor="atl-org" className="mt-4 block text-sm font-medium">Business name</label>
              <input id="atl-org" required className={field + " mt-2"} value={a.f.organization_name} onChange={(e) => a.setF({ ...a.f, organization_name: e.target.value })} />
            </>}
            <label htmlFor="atl-email" className={clsx("block text-sm font-medium", a.mode === "up" ? "mt-4" : "mt-8")}>Email</label>
            <input id="atl-email" type="email" required autoComplete="email" className={field + " mt-2"} value={a.f.email} onChange={(e) => a.setF({ ...a.f, email: e.target.value })} />
            <label htmlFor="atl-pw" className="mt-4 block text-sm font-medium">Password</label>
            <input id="atl-pw" type="password" required minLength={a.minPassword} autoComplete={a.mode === "up" ? "new-password" : "current-password"} placeholder={a.mode === "up" ? "At least 12 characters" : ""} className={field + " mt-2"} value={a.f.password} onChange={(e) => a.setF({ ...a.f, password: e.target.value })} />
            {a.err && <p role="alert" className="mt-4 text-sm text-atl-rose">{a.err}</p>}
            <button disabled={a.busy} className="mt-8 w-full rounded-full bg-atl-ink py-3 text-atl-paper hover:bg-atl-ink/85 disabled:opacity-50">{a.busy ? "One moment…" : a.mode === "in" ? "Sign in" : "Create workspace"}</button>
            <button type="button" disabled title="Planned" className="mt-3 w-full rounded-full py-3 text-sm text-atl-soft opacity-60 ring-1 ring-atl-line">Sign in with your work account (planned)</button>
          </form>
          <div className="mt-10 border-t border-atl-line pt-6 text-center">
            <p className="font-serif text-lg italic text-atl-soft">Just looking around?</p>
            <button onClick={demo} className="mt-3 w-full rounded-full bg-atl-champ/15 py-3 text-sm font-medium text-atl-champdeep hover:bg-atl-champ/25">Explore with demo data</button>
            <p className="mt-2 text-xs text-atl-soft">A fictional salon with simulated calls. Nothing is saved to a workspace.</p>
          </div>
          <p className="mt-6 text-center text-sm text-atl-soft"><Link href="/atelier" className="underline-offset-4 hover:underline">Return to the front page</Link></p>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
