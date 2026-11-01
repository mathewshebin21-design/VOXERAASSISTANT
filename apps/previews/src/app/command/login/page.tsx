"use client";

import { clsx } from "clsx";
import { AudioLines, FlaskConical, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { inputCls } from "@/components/command/ui";
import { useAuthForm } from "@/lib/live/auth-form";
import { useDataMode } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";

const label = "mt-4 block font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute";

function Login() {
  const router = useRouter();
  const sp = useSearchParams();
  const dm = useDataMode();
  const signOut = useSession((s) => s.signOut);
  const a = useAuthForm({ initialMode: sp.get("mode") === "signup" ? "up" : "in", onDone: () => router.push("/command/ops") });
  const demo = () => { dm.exploreDemo(); router.push("/command/ops"); };

  return (
    <div className="grid-bg grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-cmd-line bg-cmd-panel p-6">
          <div className="flex items-center gap-2 font-mono text-sm tracking-[0.2em]"><AudioLines size={16} className="text-cmd-violet" /> VOXERA/CMD</div>
          {dm.signedIn && (
            <div className="mt-5 rounded-md border border-cmd-ok/40 bg-cmd-ok/10 p-3 text-sm" role="status">
              Signed in as <b>{dm.user?.email}</b>{dm.org && <> · {dm.org.organization.name}</>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => { dm.backToWorkspace(); router.push("/command/ops"); }} className="rounded-md bg-cmd-violet px-3 py-1 text-xs font-medium text-white">Open console</button>
                <button onClick={() => void signOut()} className="flex items-center gap-1 rounded-md border border-cmd-line px-3 py-1 text-xs"><LogOut size={12} /> Sign out</button>
              </div>
            </div>
          )}
          <div className="mt-6 grid grid-cols-2 rounded-md border border-cmd-line p-0.5 font-mono text-xs" role="tablist" aria-label="Account">
            {(["in", "up"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={a.mode === m} onClick={() => a.setMode(m)} className={clsx("rounded py-1.5", a.mode === m ? "bg-cmd-violet text-white" : "text-cmd-mute hover:text-cmd-text")}>{m === "in" ? "Sign in" : "Create workspace"}</button>
            ))}
          </div>
          <h1 className="mt-5 text-xl font-semibold">{a.mode === "in" ? "Sign in to your workspace" : "Create a workspace"}</h1>
          <p className="mt-1 text-sm text-cmd-mute">{a.mode === "in" ? "Your real business data, stored by the VOXERA API." : "Free to start. You'll be the owner and can invite your team."}</p>
          <form onSubmit={a.submit}>
            {a.mode === "up" && <>
              <label className={label} htmlFor="cmd-name">Your name</label>
              <input id="cmd-name" required className={inputCls + " mt-1.5"} value={a.f.full_name} onChange={(e) => a.setF({ ...a.f, full_name: e.target.value })} />
              <label className={label} htmlFor="cmd-org">Business name</label>
              <input id="cmd-org" required className={inputCls + " mt-1.5"} value={a.f.organization_name} onChange={(e) => a.setF({ ...a.f, organization_name: e.target.value })} />
            </>}
            <label className={label} htmlFor="cmd-email">Email</label>
            <input id="cmd-email" type="email" required autoComplete="email" className={inputCls + " mt-1.5"} value={a.f.email} onChange={(e) => a.setF({ ...a.f, email: e.target.value })} />
            <label className={label} htmlFor="cmd-pw">Password</label>
            <input id="cmd-pw" type="password" required minLength={a.minPassword} autoComplete={a.mode === "up" ? "new-password" : "current-password"} placeholder={a.mode === "up" ? "12+ characters" : ""} className={inputCls + " mt-1.5"} value={a.f.password} onChange={(e) => a.setF({ ...a.f, password: e.target.value })} />
            {a.err && <p role="alert" className="mt-3 text-sm text-cmd-bad">{a.err}</p>}
            <button disabled={a.busy} className="mt-6 w-full rounded-md bg-cmd-violet py-2 font-medium text-white hover:bg-cmd-violet/85 disabled:opacity-50">{a.busy ? "Please wait…" : a.mode === "in" ? "Sign in" : "Create workspace"}</button>
            <button type="button" disabled title="Planned" className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-cmd-line py-2 text-sm text-cmd-mute opacity-60"><KeyRound size={14} /> SSO (planned)</button>
          </form>
        </div>
        <div className="mt-3 rounded-xl border border-dashed border-cmd-warn/50 bg-cmd-warn/5 p-4">
          <button onClick={demo} className="flex w-full items-center justify-center gap-2 rounded-md border border-cmd-warn/60 py-2 text-sm text-cmd-warn hover:bg-cmd-warn/10"><FlaskConical size={14} /> Explore with demo data</button>
          <p className="mt-2 text-center text-xs text-cmd-mute">A synthetic salon with simulated calls. Nothing you do there is saved to a workspace.</p>
        </div>
        <p className="mt-6 text-center text-xs text-cmd-mute"><Link href="/command" className="hover:text-cmd-text">← Back</Link></p>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
