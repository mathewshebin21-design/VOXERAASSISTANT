"use client";

// Choose (or switch) the interface. Only the presentation changes: bookings, agents, calls
// and settings live in the shared API and are the same in every design. The workspace owner
// sets the default for everyone; any member may pick a design just for themselves.
// Previews are real screenshots of each design's home screen with the labelled demo salon.

import { clsx } from "clsx";
import { Check, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError } from "@/lib/live/api";
import { DESIGNS, designById, useDesign, type DesignId, type DesignInfo } from "@/lib/live/design";
import { signInHref } from "@/lib/live/next-path";
import { useSession } from "@/lib/live/session";

function Frame({ d, active }: { d: DesignInfo; active: boolean }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-[#111117] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)] transition-transform duration-300 group-hover:-translate-y-1"
      style={active ? { boxShadow: `0 0 0 1px ${d.accent}, 0 24px 60px -20px ${d.accent}55` } : undefined}
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.04] px-3 py-2" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="ml-2 truncate rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-[#a8a8ba]">voxera{d.home}</span>
      </div>
      <Image
        src={d.shot}
        alt={`${d.name} home screen, showing the demo salon`}
        width={1200}
        height={750}
        sizes="(min-width: 1024px) 380px, 100vw"
        className="block h-auto w-full"
        priority={d.recommended}
        unoptimized
      />
    </div>
  );
}

function Chooser() {
  const router = useRouter();
  const isNew = useSearchParams().get("new") === "1";
  const status = useSession((s) => s.status);
  const orgsError = useSession((s) => s.orgsError);
  const reload = useSession((s) => s.load);
  const { data, error, org, setDefault, setMine } = useDesign();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (status === "loading" || (org && !data && !error)) return <p className="text-sm text-[#a8a8ba]">Loading…</p>;
  // Each case says what is actually wrong. The demo dashboards show a sample owner without any
  // session, so "signed out" must be stated plainly rather than implied.
  if (status !== "signed_in") {
    return (
      <p className="text-sm text-[#a8a8ba]" data-testid="design-signed-out">
        You&apos;re not signed in, so there is no workspace to change. The sample dashboards show a demo salon, not an account.{" "}
        <Link href={signInHref(isNew ? "/start/design?new=1" : "/start/design")} className="underline" data-testid="design-signin">Sign in to choose a design</Link>
      </p>
    );
  }
  if (orgsError) {
    return (
      <div role="alert" className="text-sm text-red-300" data-testid="design-orgs-error">
        You&apos;re signed in, but your workspaces couldn&apos;t be loaded: {orgsError}.{" "}
        <button type="button" onClick={() => void reload()} className="underline">Try again</button>
      </div>
    );
  }
  if (!org) {
    return <p className="text-sm text-[#a8a8ba]" data-testid="design-no-workspace">This account isn&apos;t a member of any workspace yet. Accept an invitation or create a workspace first.</p>;
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
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.3em] text-[#8c8c9e]">{org.organization.name}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{isNew ? "Choose how VOXERA looks" : "Switch design"}</h1>
        <p className="mt-4 text-base leading-relaxed text-[#b4b4c6]">
          Three ways to run the same receptionist. Your bookings, calls, team and settings stay exactly the same when you switch.
          {data.can_set_default
            ? " As the owner, you choose the default for everyone; anyone can still pick a design just for themselves."
            : " The workspace owner sets the default; you can pick a different design just for yourself."}
        </p>
      </header>
      {err && <p role="alert" className="mt-6 text-sm text-red-300">{err}</p>}

      <div className="mt-12 grid gap-8 lg:grid-cols-3" role="list" aria-label="Designs">
        {DESIGNS.map((d) => {
          const isEffective = data.effective === d.id;
          return (
            <div
              key={d.id}
              role="listitem"
              aria-label={d.name}
              aria-current={isEffective ? "true" : undefined}
              data-testid={`design-${d.id}`}
              className={clsx(
                "group relative flex flex-col rounded-2xl border p-4 transition-colors sm:p-5",
                isEffective ? "border-white/25 bg-white/[0.05]" : "border-white/10 bg-white/[0.02] hover:border-white/20",
              )}
            >
              <Frame d={d} active={isEffective} />
              <p className="mt-2 text-[11px] text-[#8c8c9e]">Shown with the demo salon. Your own workspace data appears once you choose.</p>

              <div className="mt-5 flex min-h-[22px] flex-wrap gap-2 text-[11px] font-medium">
                {d.recommended && <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-emerald-200">Recommended for small businesses</span>}
                {data.workspace_default === d.id && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[#e8e8f0]">Workspace default</span>}
                {data.my_override === d.id && <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 text-sky-200">Your choice</span>}
              </div>
              <h2 className="mt-3 flex items-center gap-2 text-xl font-semibold tracking-tight">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.accent }} aria-hidden />
                {d.name}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#b4b4c6]">{d.line}</p>
              <ul className="mt-4 space-y-2 text-sm text-[#d4d4e0]">
                {d.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: d.accent }} aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-[#8c8c9e]">Best for: {d.bestFor}</p>

              <div className="mt-auto space-y-2 pt-6">
                {data.can_set_default && (
                  <button
                    disabled={!!busy || (data.workspace_default === d.id && !data.my_override)}
                    onClick={() => run(`default-${d.id}`, () => setDefault(d.id))}
                    className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
                  >
                    {busy === `default-${d.id}` ? "Saving…" : data.workspace_default === d.id ? "Everyone's default" : "Use for everyone"}
                  </button>
                )}
                <button
                  disabled={!!busy || data.my_override === d.id}
                  onClick={() => run(`me-${d.id}`, () => setMine(d.id))}
                  className={clsx(
                    "w-full rounded-lg py-2.5 text-sm transition disabled:opacity-40",
                    data.can_set_default ? "border border-white/20 hover:bg-white/[0.06]" : "bg-white font-medium text-black hover:bg-white/90",
                  )}
                >
                  {busy === `me-${d.id}` ? "Saving…" : data.my_override === d.id ? "Your choice" : "Use just for me"}
                </button>
                <a href={d.preview} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 pt-1 text-xs text-[#a8a8ba] underline-offset-4 hover:text-white hover:underline">
                  Preview this design <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        {data.my_override && (
          <button disabled={!!busy} onClick={() => run("follow", () => setMine(null))} className="rounded-lg border border-white/20 px-4 py-2 hover:bg-white/[0.06] disabled:opacity-40">
            Follow the workspace default ({designById(data.workspace_default).name})
          </button>
        )}
        {!isNew && <Link href={designById(data.effective).home} className="text-[#a8a8ba] underline hover:text-white">Keep {designById(data.effective).name}</Link>}
      </div>
      <p className="mt-6 text-xs text-[#8c8c9e]">&ldquo;Preview this design&rdquo; opens its introduction in a new tab. Nothing changes until you choose, and you can switch again any time from the account menu.</p>
    </div>
  );
}

export default function DesignPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.16),transparent_60%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
        <Suspense fallback={null}><Chooser /></Suspense>
      </div>
    </main>
  );
}
