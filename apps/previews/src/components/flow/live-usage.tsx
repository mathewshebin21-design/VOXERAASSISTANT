"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "./live-ui";
import { Chip, FBtn, Glass, GHead } from "./ui";
import { api, ApiError, PERMS, type UsageSummary } from "@/lib/live/api";
import { useActiveOrg, useApi } from "@/lib/live/session";

const LABEL: Record<string, string> = { call_minutes: "Call minutes", sms_messages: "SMS messages", llm_tokens: "LLM tokens", tts_characters: "TTS characters" };

/** Metered usage from the API, with live (billable) and simulated usage kept apart. */
export function LiveUsage() {
  const active = useActiveOrg();
  const month = new Date().toISOString().slice(0, 7);
  const canRead = active ? PERMS[active.role].audit : false; // owner/admin
  const sum = useApi<UsageSummary>(active && canRead ? `/orgs/${active.organization.id}/usage/summary?month=${month}` : null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (!active) return null;
  const record = async () => {
    try {
      await api(`/orgs/${active.organization.id}/usage-events`, { method: "POST", body: { kind: "call_minutes", source: "simulated", quantity: "1", occurred_at: new Date().toISOString(), idempotency_key: `ui-test-${crypto.randomUUID()}`, reference: "usage page test" } });
      await sum.reload();
      setMsg({ kind: "ok", text: "Recorded 1 simulated minute — it never counts towards billing." });
    } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Failed" }); }
  };
  return (
    <Glass glow="cyan" className="mb-4">
      <GHead title={<span>Metered usage · {active.organization.name} · {month}</span>} right={<Chip tone="lime">live data</Chip>} />
      {!canRead ? <p className="p-4 text-sm text-flw-mute">Only owners and admins can see usage.</p> : (
        <div className="p-4">
          {sum.error && <Notice kind="error">{sum.error.detail}</Notice>}
          {sum.data && (
            <table className="w-full text-sm">
              <thead className="text-xs text-flw-mute"><tr><th className="py-1 text-left font-normal">Meter</th><th className="text-right font-normal">Live (billable)</th><th className="text-right font-normal">Simulated</th></tr></thead>
              <tbody>{Object.keys(LABEL).map((k) => (
                <tr key={k} className="border-t border-flw-line/60"><td className="py-2">{LABEL[k]}</td><td className="text-right font-mono" data-testid={`live-${k}`}>{Number(sum.data!.live[k]).toLocaleString("en-GB")}</td><td className="text-right font-mono text-flw-mute" data-testid={`sim-${k}`}>{Number(sum.data!.simulated[k]).toLocaleString("en-GB")}</td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <FBtn onClick={record}>Record a simulated test minute</FBtn>
            <span className="text-xs text-flw-mute">{sum.data?.event_count ?? 0} events this month. Real call minutes are recorded automatically from Phase 4.</span>
          </div>
          {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        </div>
      )}
    </Glass>
  );
}

function postSimulated(org: ReturnType<typeof useActiveOrg>, s: { id: string; start: number } | null) {
  if (!s || !org || !PERMS[org.role].audit) return;
  const minutes = Math.max(0.1, Math.round(((Date.now() - s.start) / 60000) * 10) / 10);
  void api(`/orgs/${org.organization.id}/usage-events`, {
    method: "POST",
    body: { kind: "call_minutes", source: "simulated", quantity: String(minutes), occurred_at: new Date(s.start).toISOString(), idempotency_key: `sim-${s.id}`, reference: "flow simulator" },
  }).catch(() => undefined);
}

/**
 * Records each simulator session as *simulated* call minutes (never billable) when a
 * signed-in owner/admin restarts or leaves it. One idempotency key per session.
 */
export function useRecordSimulatedUsage(messageCount: number) {
  const active = useActiveOrg();
  const ref = useRef<{ id: string; start: number } | null>(null);
  const orgRef = useRef(active);
  orgRef.current = active;
  useEffect(() => {
    if (messageCount > 0 && !ref.current) ref.current = { id: crypto.randomUUID(), start: Date.now() };
    if (messageCount === 0 && ref.current) { postSimulated(orgRef.current, ref.current); ref.current = null; }
  }, [messageCount]);
  useEffect(() => () => postSimulated(orgRef.current, ref.current), []);
}
