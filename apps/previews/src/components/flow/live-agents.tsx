"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmtWhen, Notice } from "./live-ui";
import { Chip, FBtn, Glass, GHead } from "./ui";
import { api, ApiError, PERMS, type Agent } from "@/lib/live/api";
import { useActiveOrg, useApi } from "@/lib/live/session";
import { usePreview } from "@/lib/store";

/** Agents saved in the signed-in workspace. Full versioned configuration arrives in Phase 9. */
export function LiveAgents() {
  const active = useActiveOrg();
  const draft = usePreview((s) => s.draft);
  const list = useApi<Agent[]>(active ? `/orgs/${active.organization.id}/agents` : null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (!active) return null;
  const base = `/orgs/${active.organization.id}/agents`;
  const canWrite = PERMS[active.role].write;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ kind: "ok", text: ok }); await list.reload(); } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Failed" }); }
  };
  const p = draft.persona;
  const greeting = p.greeting.replace("{business}", active.organization.name).replace("{agent}", p.agentName);
  const lang = draft.language.includes("US") ? "en-US" : "en-GB";
  return (
    <Glass glow="cyan" className="mb-4">
      <GHead title={<span>Saved agents · {active.organization.name}</span>} right={<Chip tone="lime">live data</Chip>} />
      <div className="p-4">
        {list.data && list.data.length === 0 && <p className="text-sm text-flw-mute">No agents saved in this workspace yet.</p>}
        <ul className="space-y-2">{list.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-flw-line px-3 py-2.5">
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{a.name}</div><div className="truncate text-xs text-flw-mute">“{a.greeting}” · {a.voice_id} · {a.language} · saved {fmtWhen(a.created_at)}</div></div>
            {canWrite ? (
              <select aria-label={`Status for ${a.name}`} className="rounded-lg border border-flw-line bg-flw-bg px-2 py-1 text-xs" value={a.status} onChange={(e) => run(() => api(`${base}/${a.id}`, { method: "PATCH", body: { status: e.target.value } }), "Status updated")}>
                <option value="draft">draft</option><option value="paused">paused</option><option value="live" disabled>live (needs telephony)</option>
              </select>
            ) : <Chip>{a.status}</Chip>}
            {canWrite && <button aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete ${a.name}?`) && run(() => api(`${base}/${a.id}`, { method: "DELETE" }), "Agent deleted")} className="text-flw-mute hover:text-flw-pink"><Trash2 size={14} /></button>}
          </li>
        ))}</ul>
        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <FBtn variant="glow" onClick={() => run(() => api(base, { method: "POST", body: { name: p.agentName, greeting, voice_id: draft.voiceId, language: lang } }), `Saved “${p.agentName}” to ${active.organization.name}`)}><Plus size={14} /> Save current draft as an agent</FBtn>
            <span className="text-xs text-flw-mute">Saves name, greeting, voice and language. The API rejects greetings that don&apos;t disclose AI.</span>
          </div>
        )}
        {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      </div>
    </Glass>
  );
}
