"use client";

// One entry point for every customer: sign in (or create a workspace), then open the
// workspace in the design it uses. New workspaces choose their design first.

import { clsx } from "clsx";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuthForm } from "@/lib/live/auth-form";
import { designById, useDesign } from "@/lib/live/design";
import { safeNext } from "@/lib/live/next-path";
import { useSession } from "@/lib/live/session";

const input = "mt-1.5 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm outline-none transition focus:border-white/50 focus:bg-white/[0.06]";

function SignedInRedirect({ next }: { next: string | null }) {
  const router = useRouter();
  const { data, error, org } = useDesign();
  const orgsError = useSession((s) => s.orgsError);
  const reload = useSession((s) => s.load);
  useEffect(() => {
    // A page that sent the visitor here to sign in gets them back; otherwise open their design.
    if (next && org) router.replace(next);
    else if (data) router.replace(designById(data.effective).home);
  }, [next, org, data, router]);
  if (orgsError) {
    return (
      <div role="alert" className="text-sm text-red-300">
        Signed in, but your workspaces couldn&apos;t be loaded: {orgsError}.{" "}
        <button type="button" onClick={() => void reload()} className="underline">Try again</button>
      </div>
    );
  }
  if (!org) return <p className="text-sm text-[#a8a8ba]">This account isn&apos;t a member of any workspace yet.</p>;
  if (error) return <p role="alert" className="text-sm text-red-300">Couldn&apos;t open your workspace: {error.detail}</p>;
  return <p className="text-sm text-[#a8a8ba]" data-testid="start-opening">Opening {org.organization.name}…</p>;
}

function AuthForm({ onSignUp }: { onSignUp: (pending: boolean) => void }) {
  const router = useRouter();
  const form = useAuthForm({
    onDone: () => {
      // A new workspace picks its design first; returning users go straight in.
      if (form.mode === "up") router.push("/start/design?new=1");
    },
  });
  const { mode, setMode, f, setF, err, busy, submit, minPassword } = form;
  // Mark a sign-up before the session flips to signed-in, so the redirect below never
  // races the chooser. Cleared again if sign-up fails.
  const onSubmit = async (e: React.FormEvent) => {
    onSignUp(mode === "up");
    await submit(e);
  };
  useEffect(() => { if (err) onSignUp(false); }, [err, onSignUp]);
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={mode === "in" ? "Sign in" : "Create workspace"}>
      <div className="grid grid-cols-2 rounded-lg border border-white/15 p-1 text-sm" role="tablist">
        {(["in", "up"] as const).map((m) => (
          <button type="button" key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx("rounded-md py-1.5", mode === m ? "bg-white/15" : "text-[#a8a8ba]")}>
            {m === "in" ? "Sign in" : "Create workspace"}
          </button>
        ))}
      </div>
      {mode === "up" && <>
        <label className="block text-sm text-[#d4d4e0]">Your name<input required className={input} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="block text-sm text-[#d4d4e0]">Business name<input required className={input} value={f.organization_name} onChange={(e) => setF({ ...f, organization_name: e.target.value })} /></label>
      </>}
      <label className="block text-sm text-[#d4d4e0]">Email<input required type="email" autoComplete="email" className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="block text-sm text-[#d4d4e0]">Password<input required type="password" minLength={minPassword} autoComplete={mode === "in" ? "current-password" : "new-password"} className={input} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50">
        {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create workspace"}
      </button>
    </form>
  );
}

function Showcase() {
  // Real screenshots of the three designs (demo salon), fanned like a deck.
  const [front, ...back] = [designById("atelier"), designById("command"), designById("flow")];
  return (
    <div aria-hidden className="relative mx-auto mt-12 hidden h-[300px] w-full max-w-[520px] lg:block">
      {back.map((d, i) => (
        <div key={d.id} className={clsx("absolute w-[78%] overflow-hidden rounded-xl border border-white/10 shadow-2xl", i === 0 ? "left-0 top-0 -rotate-6" : "right-0 top-2 rotate-6")}>
          <Image src={d.shot} alt="" width={1200} height={750} unoptimized className="block h-auto w-full opacity-70" />
        </div>
      ))}
      <div className="absolute left-1/2 top-14 w-[82%] -translate-x-1/2 overflow-hidden rounded-xl border border-white/20 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <Image src={front.shot} alt="" width={1200} height={750} unoptimized priority className="block h-auto w-full" />
      </div>
    </div>
  );
}

/** Reads ?next= (client-only), so only this small part waits for the URL. */
function SignedInWithNext() {
  return <SignedInRedirect next={safeNext(useSearchParams().get("next"))} />;
}

export default function Start() {
  const status = useSession((s) => s.status);
  const [signingUp, setSigningUp] = useState(false);
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(139,92,246,0.18),transparent_55%),radial-gradient(ellipse_at_90%_100%,rgba(201,170,120,0.12),transparent_50%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_1fr]">
        <section>
          <p className="text-xs uppercase tracking-[0.3em] text-[#8c8c9e]">VOXERA AI</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your AI receptionist</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#b4b4c6]">
            Answers every call, books appointments and hands the rest to your team. Run it in the design that suits how you work: Atelier, Command or Flow.
          </p>
          <Showcase />
        </section>
        <div className="w-full max-w-sm justify-self-center lg:justify-self-end">
          <div className="rounded-2xl border border-white/10 bg-[#121218]/80 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur sm:p-7">
            {status === "loading" ? <p className="text-sm text-[#a8a8ba]">Loading…</p>
              : status === "signed_in" && signingUp ? <p className="text-sm text-[#a8a8ba]">Creating your workspace…</p>
              : status === "signed_in" ? <Suspense fallback={<p className="text-sm text-[#a8a8ba]">Loading…</p>}><SignedInWithNext /></Suspense>
              : <AuthForm onSignUp={setSigningUp} />}
          </div>
          <p className="mt-4 text-center text-xs text-[#8c8c9e]">New workspaces choose their design next. You can switch at any time.</p>
        </div>
      </div>
    </main>
  );
}
