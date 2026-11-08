"use client";

import { useState } from "react";
import { useDataMode } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";

/**
 * Wraps every dashboard design. When a signed-in user's workspaces could not be loaded it shows
 * that, in place of the dashboard, instead of letting screens fall back to demo data. Demo data
 * stays available only as an explicit, labelled choice.
 */
export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const dm = useDataMode();
  const load = useSession((s) => s.load);
  const signOut = useSession((s) => s.signOut);
  const [busy, setBusy] = useState(false);
  if (dm.mode !== "unavailable") return <>{children}</>;

  const retry = async () => { setBusy(true); try { await load(); } finally { setBusy(false); } };
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 text-slate-900">
      <section role="alert" data-testid="workspace-unavailable" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Your workspace couldn&apos;t be loaded</h1>
        <p className="mt-2 text-sm text-slate-600">
          You&apos;re signed in{dm.user?.email ? <> as <strong className="font-medium text-slate-900">{dm.user.email}</strong></> : null}, but we couldn&apos;t
          reach your workspace. Nothing has been shown in its place, so no figures on screen could be mistaken for yours.
        </p>
        {dm.orgsError && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600">{dm.orgsError}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={retry} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {busy ? "Trying…" : "Try again"}
          </button>
          <button onClick={dm.exploreDemo} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-500">
            Explore demo data instead
          </button>
          <button onClick={() => void signOut()} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
