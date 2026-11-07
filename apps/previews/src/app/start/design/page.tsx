"use client";

// Choose (or switch) the interface. Only the presentation changes: bookings, agents, calls
// and settings live in the shared API and are the same in every design. The workspace owner
// sets the default for everyone; any member may pick a design just for themselves.

import { clsx } from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError } from "@/lib/live/api";
import { DESIGNS, designById, useDesign, type DesignId } from "@/lib/live/design";
import { useSession } from "@/lib/live/session";

function Chooser() {
  const router = useRouter();
  const isNew = useSearchParams().get("new") === "1";
  const status = useSession((s) => s.status);
  const { data, error, org, setDefault, setMine } = useDesign();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (status === "loading" || (org && !data && !error)) return <p className="text-sm text-[#a8a8ba]">Loading…</p>;
  if (status !== "signed_in" || !org) {
    return <p className="text-sm text-[#a8a8ba]">Sign in first. <Link href="/start" className="underline">Go to sign in</Link></p>;
  }
  if (error || !data) return <p role="alert" className="text-sm text-red-300">Couldn&apos;t load your design settings: {error?.detail}</p>;

  const run = async (key: string, fn: () => Promise<{ effective: DesignId }>) => {
    setBusy(key); setErr(null);
    try {
      const s = await fn();
      router.push(designById(s.effective).home);
    } catch (x) {
      setErr(x instanceof ApiError ? x.detail : "Something went wrong");
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.3em] text-[#8c8c9e]">{org.organization.name}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{isNew ? "Choose how VOXERA looks" : "Switch design"}</h1>
      <p className="mt-3 max-w-2xl text-sm text-[#a8a8ba]">
        All three designs show the same workspace: your bookings, receptionist, calls and settings stay exactly the same when you switch.
        {data.can_set_default
          ? " As the owner, you choose the default for everyone in the workspace; anyone can still pick a design just for themselves."
          : " The workspace owner sets the default; you can pick a different design just for yourself."}
      </p>
      {err && <p role="alert" className="mt-4 text-sm text-red-300">{err}</p>}
      <div className="mt-8 grid gap-5 md:grid-cols-3" role="list" aria-label="Designs">
        {DESIGNS.map((d) => {
          const isEffective = data.effective === d.id;
          return (
            <section key={d.id} role="listitem" aria-label={d.name} data-testid={`design-${d.id}`} className={clsx("flex flex-col overflow-hidden rounded-2xl border bg-white/[0.03]", isEffective ? "border-white/60" : "border-white/10")}>
              <div className={`h-28 bg-gradient-to-br ${d.swatch}`} />
              <div className="flex flex-1 flex-col p-5">
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {d.recommended && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-200">Recommended for small businesses</span>}
                  {data.workspace_default === d.id && <span className="rounded-full bg-white/10 px-2 py-0.5">Workspace default</span>}
                  {data.my_override === d.id && <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-sky-200">Your choice</span>}
                </div>
                <h2 className="mt-2 text-lg font-semibold">{d.name}</h2>
                <p className="mt-1 text-sm text-[#a8a8ba]">{d.line}</p>
                <p className="mt-2 text-xs text-[#8c8c9e]">Best for: {d.bestFor}</p>
                <div className="mt-auto space-y-2 pt-5">
                  {data.can_set_default && (
                    <button disabled={!!busy || (data.workspace_default === d.id && !data.my_override)} onClick={() => run(`default-${d.id}`, () => setDefault(d.id))} className="w-full rounded-lg bg-white py-2 text-sm font-medium text-black disabled:opacity-40">
                      {busy === `default-${d.id}` ? "Saving…" : data.workspace_default === d.id ? "Everyone's default" : "Use for everyone"}
                    </button>
                  )}
                  <button disabled={!!busy || data.my_override === d.id} onClick={() => run(`me-${d.id}`, () => setMine(d.id))} className={clsx("w-full rounded-lg py-2 text-sm", data.can_set_default ? "border border-white/20" : "bg-white font-medium text-black", "disabled:opacity-40")}>
                    {busy === `me-${d.id}` ? "Saving…" : data.my_override === d.id ? "Your choice" : "Use just for me"}
                  </button>
                  <a href={d.preview} target="_blank" rel="noreferrer" className="block text-center text-xs text-[#a8a8ba] underline hover:text-white">
                    Preview this design
                  </a>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
        {data.my_override && (
          <button disabled={!!busy} onClick={() => run("follow", () => setMine(null))} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40">
            Follow the workspace default ({designById(data.workspace_default).name})
          </button>
        )}
        {!isNew && <Link href={designById(data.effective).home} className="text-[#a8a8ba] underline hover:text-white">Keep {designById(data.effective).name}</Link>}
      </div>
      <p className="mt-6 text-xs text-[#8c8c9e]">&ldquo;Preview this design&rdquo; opens its introduction in a new tab. Nothing changes until you choose.</p>
    </div>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <Suspense fallback={null}><Chooser /></Suspense>
    </main>
  );
}
