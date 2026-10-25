"use client";

import { clsx } from "clsx";
import { KeyRound, Lock } from "lucide-react";
import { useState } from "react";
import { Chip, FBtn, Glass, GHead, Heading } from "@/components/flow/ui";
import { INTEGRATIONS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";
import type { Integration } from "@/lib/types";

const TOOLS = [
  { name: "check_availability", via: "Google Calendar (demo)", risk: "read", always: false },
  { name: "create_booking", via: "Google Calendar (demo)", risk: "write · requires caller confirmation", always: false },
  { name: "reschedule_booking", via: "Google Calendar (demo)", risk: "write · requires confirmation", always: false },
  { name: "cancel_booking", via: "Google Calendar (demo)", risk: "write · requires confirmation", always: false },
  { name: "search_knowledge", via: "Voxera knowledge", risk: "read", always: true },
  { name: "take_message", via: "Email notifications", risk: "write · internal", always: true },
  { name: "transfer_call", via: "Telephony — not connected", risk: "call control", always: false },
  { name: "escalate", via: "SMS to owner (demo)", risk: "alert", always: true },
  { name: "crm_upsert_contact", via: "HubSpot — not connected", risk: "write · external", always: false },
];

const WEBHOOK_LOG = [
  ["09:14:02", "call.completed", "200", "1"], ["09:14:03", "appointment.created", "200", "1"], ["11:02:41", "call.completed", "502", "1"],
  ["11:02:46", "call.completed", "200", "2 (retry)"], ["13:30:10", "message.taken", "200", "1"],
];

export default function Tools() {
  const p = usePreview((s) => s.draft.persona);
  const setPersona = usePreview((s) => s.setPersona);
  const [sel, setSel] = useState<Integration>(INTEGRATIONS[0]);
  const enabled = (n: string) => (n.includes("booking") || n === "check_availability" ? p.allowBooking : n === "transfer_call" ? p.allowTransfer : n.startsWith("crm") ? false : true);
  return (
    <>
      <Heading kicker="Tools & integrations" title="What the agent can touch"><Chip tone="amber">no live connections</Chip></Heading>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Glass glow="cyan">
          <GHead title="Tool registry" right={<span className="font-mono text-[10px] text-flw-mute">validated · logged · retry-safe</span>} />
          <ul>
            {TOOLS.map((t) => (
              <li key={t.name} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0">
                <span className={clsx("h-2 w-2 rounded-full", enabled(t.name) ? "bg-flw-cyan shadow-[0_0_10px_rgb(var(--flw-cyan))]" : "bg-flw-line")} />
                <div className="min-w-0 flex-1"><div className="font-mono text-sm">{t.name}</div><div className="truncate text-xs text-flw-mute">{t.via} · {t.risk}</div></div>
                {t.always ? <Chip><Lock size={10} /> always on</Chip>
                  : t.name.includes("booking") || t.name === "check_availability" ? <FBtn onClick={() => setPersona({ allowBooking: !p.allowBooking })}>{p.allowBooking ? "Disable" : "Enable"} booking</FBtn>
                  : t.name === "transfer_call" ? <FBtn onClick={() => setPersona({ allowTransfer: !p.allowTransfer })}>{p.allowTransfer ? "Disable" : "Enable"}</FBtn>
                  : <Chip>needs integration</Chip>}
              </li>
            ))}
          </ul>
        </Glass>
        <div className="space-y-4">
          <Glass>
            <GHead title="Integrations" />
            <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              {INTEGRATIONS.map((i) => (
                <li key={i.id}>
                  <button onClick={() => setSel(i)} className={clsx("h-full w-full rounded-xl border p-3 text-left transition", sel.id === i.id ? "border-flw-violet bg-flw-violet/10" : "border-flw-line bg-flw-surface/50 hover:border-flw-violet/50")}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{i.name}</span><Chip tone={i.status === "connected" ? "lime" : i.status === "available" ? "cyan" : "mute"}>{i.status === "connected" ? "demo" : i.status}</Chip></div>
                    <div className="mt-1 line-clamp-2 text-xs text-flw-mute">{i.description}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Glass>
          <Glass glow="violet">
            <GHead title={sel.name} right={<Chip>{sel.category}</Chip>} />
            <div className="p-4">
              <p className="text-sm text-flw-mute">{sel.description}</p>
              <dl className="mt-3 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between gap-4"><dt className="text-flw-mute">auth</dt><dd>{sel.auth}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-flw-mute">scopes</dt><dd className="text-right">{sel.scopes?.join(", ") ?? "least-privilege, set at connect"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-flw-mute">secrets</dt><dd>server-side vault, per tenant</dd></div>
              </dl>
              <FBtn variant="glow" className="mt-4" disabled title="Inactive in the preview"><KeyRound size={14} /> {sel.status === "connected" ? "Manage" : sel.status === "planned" ? "Planned" : "Connect"}</FBtn>
              <p className="mt-2 text-[11px] text-flw-mute">OAuth flows, token storage and scope review are built in Phase 8.</p>
            </div>
          </Glass>
          <Glass>
            <GHead title="Outbound webhook deliveries (demo)" />
            <table className="w-full font-mono text-[11px]"><tbody>{WEBHOOK_LOG.map(([t, e, code, attempt], i) => (
              <tr key={i} className="border-t border-flw-line/60 first:border-0"><td className="px-4 py-1.5 text-flw-mute">{t}</td><td>{e}</td><td className={code === "200" ? "text-flw-lime" : "text-flw-pink"}>{code}</td><td className="px-4 text-right text-flw-mute">#{attempt}</td></tr>
            ))}</tbody></table>
            <p className="border-t border-flw-line/60 px-4 py-2 text-[11px] text-flw-mute">HMAC-SHA256 signed · exponential back-off · same event ID on retry for de-duplication.</p>
          </Glass>
        </div>
      </div>
    </>
  );
}
