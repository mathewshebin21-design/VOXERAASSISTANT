"use client";

import { useState } from "react";
import { Notice } from "./live-ui";
import { Chip, FBtn, Glass, GHead } from "./ui";
import { api, ApiError, PERMS } from "@/lib/live/api";
import { CHANNEL_LABEL, durationLabel, eventLine, STATUS_LABEL, type CallDetail, type CallRecord } from "@/lib/live/calls";
import { useActiveOrg, useApi } from "@/lib/live/session";

/** The workspace's own call records (simulated and Voice lab calls today; phone calls later). */
export function LiveCalls() {
  const active = useActiveOrg();
  const list = useApi<CallRecord[]>(active ? `/orgs/${active.organization.id}/calls?limit=20` : null);
  const [open, setOpen] = useState<CallDetail | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (!active) return null;
  const isOwner = PERMS[active.role].owner;

  const show = async (id: string) => {
    if (open?.id === id) return setOpen(null);
    try { setOpen(await api<CallDetail>(`/orgs/${active.organization.id}/calls/${id}`)); }
    catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Could not load the call" }); }
  };
  const erase = async (id: string) => {
    if (!window.confirm("Erase this call and its transcript? This cannot be undone.")) return;
    try {
      await api(`/orgs/${active.organization.id}/calls/${id}`, { method: "DELETE" });
      setOpen(null);
      await list.reload();
      setMsg({ kind: "ok", text: "Call and transcript erased." });
    } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Could not erase the call" }); }
  };

  return (
    <Glass glow="cyan" className="mb-4">
      <GHead title={<span>Recorded calls · {active.organization.name}</span>} right={<Chip tone="lime">live data</Chip>} />
      <div className="p-4" data-testid="live-calls">
        {list.error && <Notice kind="error">{list.error.detail}</Notice>}
        {list.data && list.data.length === 0 && (
          <p className="text-sm text-flw-mute">No calls recorded yet. Test calls from the Voice lab and simulated calls appear here; phone calls will once telephony is connected.</p>
        )}
        {list.data && list.data.length > 0 && (
          <ul className="divide-y divide-flw-line/60">
            {list.data.map((c) => (
              <li key={c.id} className="py-2">
                <button type="button" onClick={() => show(c.id)} className="flex w-full flex-wrap items-center gap-2 text-left text-sm" data-testid="call-row">
                  <span className="w-40 text-flw-mute">{new Date(c.started_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <Chip tone={c.status === "completed" ? "lime" : c.status === "in_progress" ? "cyan" : "amber"}>{STATUS_LABEL[c.status]}</Chip>
                  <Chip>{CHANNEL_LABEL[c.channel]}</Chip>
                  <span className="flex-1">{c.caller_name ?? "Unknown caller"}{c.outcome ? ` · ${c.outcome.replace(/_/g, " ")}` : ""}</span>
                  <span className="font-mono text-xs text-flw-mute">{durationLabel(c.summary.duration_ms)} · {c.event_count} events</span>
                </button>
                {open?.id === c.id && (
                  <div className="mt-2 rounded-xl border border-flw-line/60 p-3" data-testid="call-transcript">
                    <div className="mb-2 flex flex-wrap gap-2 text-xs text-flw-mute">
                      <span>AI disclosure {open.ai_disclosure_played ? "played" : "not played"}</span>
                      <span>· recording notice {open.recording_notice_played ? "played" : "not played"}</span>
                      <span>· no audio stored</span>
                    </div>
                    <ol className="space-y-1 text-sm">
                      {open.events.map((e) => {
                        const l = eventLine(e);
                        return (
                          <li key={e.seq} className={l.muted ? "text-flw-mute" : ""}>
                            <span className="mr-2 inline-block w-28 text-xs uppercase tracking-wide text-flw-mute">{l.who}</span>
                            {l.text}
                          </li>
                        );
                      })}
                    </ol>
                    {isOwner && (
                      <div className="mt-3"><FBtn onClick={() => erase(c.id)} data-testid="erase-call">Erase call</FBtn></div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      </div>
    </Glass>
  );
}
