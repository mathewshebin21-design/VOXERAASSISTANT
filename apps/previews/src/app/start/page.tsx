"use client";

// One entry point for every customer: sign in (or create a workspace), then open the
// workspace in the design it uses. New workspaces choose their design first.

import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthForm } from "@/lib/live/auth-form";
import { designById, useDesign } from "@/lib/live/design";
import { useSession } from "@/lib/live/session";

const input = "w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-sm outline-none focus:border-white/50";

function SignedInRedirect() {
  const router = useRouter();
  const { data, error, org } = useDesign();
  useEffect(() => {
    if (data) router.replace(designById(data.effective).home);
  }, [data, router]);
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
    <form onSubmit={onSubmit} className="space-y-3" aria-label={mode === "in" ? "Sign in" : "Create workspace"}>
      <div className="grid grid-cols-2 rounded-lg border border-white/15 p-1 text-sm" role="tablist">
        {(["in", "up"] as const).map((m) => (
          <button type="button" key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx("rounded-md py-1.5", mode === m ? "bg-white/15" : "text-[#a8a8ba]")}>
            {m === "in" ? "Sign in" : "Create workspace"}
          </button>
        ))}
      </div>
      {mode === "up" && <>
        <label className="block text-sm">Your name<input required className={input} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="block text-sm">Business name<input required className={input} value={f.organization_name} onChange={(e) => setF({ ...f, organization_name: e.target.value })} /></label>
      </>}
      <label className="block text-sm">Email<input required type="email" autoComplete="email" className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="block text-sm">Password<input required type="password" minLength={minPassword} autoComplete={mode === "in" ? "current-password" : "new-password"} className={input} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-white py-2 text-sm font-medium text-black disabled:opacity-50">
        {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create workspace"}
      </button>
    </form>
  );
}

export default function Start() {
  const status = useSession((s) => s.status);
  const [signingUp, setSigningUp] = useState(false);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-[#8c8c9e]">VOXERA AI</p>
        <h1 className="mt-2 text-2xl font-semibold">Your AI receptionist</h1>
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          {status === "loading" ? <p className="text-sm text-[#a8a8ba]">Loading…</p>
            : status === "signed_in" && signingUp ? <p className="text-sm text-[#a8a8ba]">Creating your workspace…</p>
            : status === "signed_in" ? <SignedInRedirect />
            : <AuthForm onSignUp={setSigningUp} />}
        </div>
      </div>
    </main>
  );
}
