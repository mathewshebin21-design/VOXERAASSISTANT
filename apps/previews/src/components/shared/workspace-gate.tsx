"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/live/api";
import { useDataMode } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";

/**
 * Wraps every dashboard design. A signed-in user never sees demo data in place of their own:
 * - if their workspaces could not be loaded, it says so, with Try again;
 * - if they have no workspace at all, it offers to create one.
 * Demo data stays available only as an explicit, labelled choice.
 */
export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const dm = useDataMode();
  if (dm.mode === "unavailable") return <Unavailable />;
  if (dm.mode === "no_workspace") return <NoWorkspace />;
  return <>{children}</>;
}

const shell = "grid min-h-screen place-items-center bg-slate-50 px-4 text-slate-900";
const card = "w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const primary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-500";
const quiet = "rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900";

function SignedInAs() {
  const { user } = useDataMode();
  return <>You&apos;re signed in{user?.email ? <> as <strong className="font-medium text-slate-900">{user.email}</strong></> : null}</>;
}

function Unavailable() {
  const dm = useDataMode();
  const load = useSession((s) => s.load);
  const signOut = useSession((s) => s.signOut);
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); try { await load(); } finally { setBusy(false); } };
  return (
    <main className={shell}>
      <section role="alert" data-testid="workspace-unavailable" className={card}>
        <h1 className="text-lg font-semibold">Your workspace couldn&apos;t be loaded</h1>
        <p className="mt-2 text-sm text-slate-600">
          <SignedInAs />, but we couldn&apos;t reach your workspace. Nothing has been shown in its place, so no
          figures on screen could be mistaken for yours.
        </p>
        {dm.orgsError && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600">{dm.orgsError}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={retry} disabled={busy} className={primary}>{busy ? "Trying…" : "Try again"}</button>
          <button onClick={dm.exploreDemo} className={secondary}>Explore demo data instead</button>
          <button onClick={() => void signOut()} className={quiet}>Sign out</button>
        </div>
      </section>
    </main>
  );
}

function NoWorkspace() {
  const dm = useDataMode();
  const router = useRouter();
  const path = usePathname();
  const reloadOrgs = useSession((s) => s.reloadOrgs);
  const switchOrg = useSession((s) => s.switchOrg);
  const signOut = useSession((s) => s.signOut);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [delError, setDelError] = useState<string | null>(null);
  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelError(null);
    try {
      await api("/me", { method: "DELETE", body: { password: pw } });
      await signOut();
      router.push(`/${path.split("/")[1] ?? ""}`); // this design's home page
    } catch (err) {
      setDelError(err instanceof ApiError ? err.detail : "Network error");
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ id: string }>("/orgs", { method: "POST", body: { name: name.trim() } });
      await reloadOrgs();
      switchOrg(org.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Network error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={shell}>
      <section data-testid="workspace-none" className={card}>
        <h1 className="text-lg font-semibold">You don&apos;t have a workspace yet</h1>
        <p className="mt-2 text-sm text-slate-600">
          <SignedInAs />, but you aren&apos;t a member of any workspace, so there is nothing of yours to show. Create
          one, or ask a colleague to invite you to theirs.
        </p>
        <form onSubmit={create} className="mt-5 space-y-3">
          <label htmlFor="new-workspace-name" className="block text-sm font-medium">Business name</label>
          <input id="new-workspace-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !name.trim()} className={primary}>{busy ? "Creating…" : "Create workspace"}</button>
            <button type="button" onClick={dm.exploreDemo} className={secondary}>Explore demo data instead</button>
            <button type="button" onClick={() => void signOut()} className={quiet}>Sign out</button>
          </div>
        </form>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h2 className="text-sm font-medium text-slate-700">Or delete your account</h2>
          <form onSubmit={deleteAccount} className="mt-3 space-y-2">
            <label htmlFor="delete-account-password" className="block text-sm">Your password</label>
            <input id="delete-account-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none" />
            {delError && <p role="alert" className="text-sm text-red-700">{delError}</p>}
            <button type="submit" disabled={!pw} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:border-red-500 disabled:opacity-50">
              Delete my account
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
