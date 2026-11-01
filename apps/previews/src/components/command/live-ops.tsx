"use client";

import { clsx } from "clsx";
import { Check, Circle, PhoneOff, RefreshCw } from "lucide-react";
import Link from "next/link";
import { PageHead, Panel, Stat, Tag } from "@/components/command/ui";
import { fmtIn, useWorkspaceDashboard } from "@/lib/live/dashboard";

const KIND = { transfer: "Transferred call", callback: "Call back", message: "Message" } as const;

/** Operations for a signed-in workspace: real bookings, desk and setup; honest empty states for calls. */
export function LiveOps({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { data: d, error, reload } = useWorkspaceDashboard(orgId);
  const head = (
    <PageHead kicker="Operate · overview" title="Operations">
      <button onClick={() => void reload()} className="flex items-center gap-1.5 rounded-md border border-cmd-line px-2.5 py-1 font-mono text-xs text-cmd-mute hover:text-cmd-text" aria-label="Refresh"><RefreshCw size={12} /> refresh</button>
      <Tag tone="ok">Live · {orgName}</Tag>
    </PageHead>
  );
  if (error) return <>{head}<Panel title="Couldn't load your workspace"><p className="text-sm text-cmd-bad" role="alert">{error}</p></Panel></>;
  if (!d) return <>{head}<div className="grid grid-cols-2 gap-3 md:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-lg border border-cmd-line bg-cmd-panel" />)}</div></>;
  const tz = d.timezone;
  const setupLeft = d.setup.length - d.setupDone;
  const usage = d.usage;

  const setup = (
    <Panel title={d.isNew ? `Welcome to ${d.businessName || orgName}` : "Finish setting up"} action={<span className="font-mono text-[10px] text-cmd-mute">{d.setupDone}/{d.setup.length} done</span>}>
      {d.isNew && <p className="mb-3 text-sm text-cmd-mute">Your workspace is brand new — nothing to report yet. These steps get your receptionist ready to take calls:</p>}
      <div className="mb-3 h-1.5 overflow-hidden rounded bg-cmd-raised"><div className="h-full rounded bg-cmd-violet" style={{ width: `${(d.setupDone / d.setup.length) * 100}%` }} /></div>
      <ul className="space-y-1.5" data-testid="cmd-setup">
        {d.setup.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            {s.done ? <Check size={14} className="text-cmd-ok" /> : <Circle size={14} className="text-cmd-mute" />}
            <span className={clsx("flex-1", s.done && "text-cmd-mute line-through")}>{s.label}</span>
            {!s.done && <Link href={s.href} className="font-mono text-[11px] text-cmd-violet hover:underline">open ↗</Link>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-cmd-mute">Steps open the setup assistant, which asks you a few questions and saves the answers.</p>
    </Panel>
  );

  return (
    <>
      {head}
      {d.isNew && <div className="mb-4">{setup}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Calls" value="—" sub="no phone line connected yet" />
        <Stat label="Bookings · next 7 days" value={d.next7Days} sub={`${d.upcoming.length} upcoming in total`} tone="violet" />
        <Stat label="Booked by AI" value={d.bookedByAi} sub="of the upcoming bookings" tone="cyan" />
        <Stat label="Waiting on the desk" value={d.waiting.length} sub={d.urgent ? `${d.urgent} urgent` : "no urgent cases"} tone={d.waiting.length ? "warn" : "text"} href="/flow/app/desk" />
        <Stat label="Resolved · 7 days" value={d.resolved7Days} sub={`${d.inProgress} in progress now`} tone="ok" />
        <Stat label="Team available" value={`${d.teamAvailable}/${d.teamOnDesk}`} sub="on the staff desk" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Upcoming bookings" className="xl:col-span-2" dense action={<span className="font-mono text-[10px] text-cmd-mute">{tz}</span>}>
          {d.upcoming.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="cmd-bookings">
                <tbody>
                  {d.upcoming.slice(0, 10).map((a) => (
                    <tr key={a.id} className="border-t border-cmd-line first:border-0">
                      <td className="px-4 py-2 font-mono text-xs text-cmd-mute">{fmtIn(a.starts_at, tz)}</td>
                      <td className="px-2 py-2">{a.customer_name}</td>
                      <td className="px-2 py-2 text-cmd-mute">{a.service_name}</td>
                      <td className="px-4 py-2 text-right"><Tag tone={a.source === "ai_receptionist" ? "cyan" : "mute"}>{a.source === "ai_receptionist" ? "AI" : "staff"}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 py-6 text-sm text-cmd-mute">No bookings yet. They appear here as soon as your receptionist or your team books someone in.</p>}
        </Panel>
        <Panel title="Desk queue" action={<Link href="/flow/app/desk" className="font-mono text-[11px] text-cmd-violet hover:underline">open desk ↗</Link>}>
          {d.waiting.length ? (
            <ul className="space-y-2.5" data-testid="cmd-queue">
              {d.waiting.slice(0, 6).map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="flex items-center gap-2"><span className="font-medium">{c.caller_name ?? "Unknown caller"}</span><Tag tone={c.urgent ? "bad" : "mute"}>{c.urgent ? "urgent" : KIND[c.kind]}</Tag></div>
                  <p className="line-clamp-1 text-xs text-cmd-mute">{c.summary}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-cmd-mute">Nobody waiting. Messages and transfers from the receptionist land here.</p>}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Calls">
          <div className="flex items-start gap-3">
            <PhoneOff size={18} className="mt-0.5 text-cmd-mute" />
            <p className="text-sm text-cmd-mute" data-testid="cmd-no-calls">No calls yet. Call volume, outcomes and transcripts appear here once a phone line is connected. Until then, try your receptionist in the <Link href="/flow/app/voice" className="text-cmd-violet hover:underline">voice lab ↗</Link>.</p>
          </div>
          {d.voiceSessions.length > 0 && (
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute">Recent test calls</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {d.voiceSessions.map((v) => <li key={v.id} className="flex justify-between"><span>{fmtIn(v.started_at, tz)}</span><span className="font-mono text-cmd-mute">{v.summary.turns} turns · first audio {v.summary.time_to_first_audio_ms ?? "—"} ms</span></li>)}
              </ul>
            </div>
          )}
        </Panel>
        <Panel title={`Usage · ${new Date().toLocaleString("en-GB", { month: "long" })}`}>
          {usage ? (
            <table className="w-full text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.15em] text-cmd-mute"><tr><th className="text-left font-normal">meter</th><th className="text-right font-normal">live</th><th className="text-right font-normal">test</th></tr></thead>
              <tbody>
                {[["call_minutes", "Call minutes"], ["llm_tokens", "AI tokens"], ["tts_characters", "Voice characters"]].map(([k, l]) => (
                  <tr key={k} className="border-t border-cmd-line"><td className="py-1.5">{l}</td><td className="text-right font-mono">{Number(usage.live[k] ?? 0).toLocaleString("en-GB")}</td><td className="text-right font-mono text-cmd-mute">{Number(usage.simulated[k] ?? 0).toLocaleString("en-GB")}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-cmd-mute">Usage is visible to owners and admins.</p>}
        </Panel>
        {!d.isNew && setupLeft > 0 && setup}
      </div>
    </>
  );
}
