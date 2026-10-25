"use client";

import { clsx } from "clsx";
import { Lock } from "lucide-react";
import { Chip, FBtn, Glass, GHead, Heading } from "@/components/flow/ui";
import { INTEGRATIONS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";

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

export default function Tools() {
  const p = usePreview((s) => s.draft.persona);
  const setPersona = usePreview((s) => s.setPersona);
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
        <Glass>
          <GHead title="Integrations" />
          <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {INTEGRATIONS.map((i) => (
              <li key={i.id} className="rounded-xl border border-flw-line bg-flw-surface/50 p-3">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{i.name}</span><Chip tone={i.status === "connected" ? "lime" : i.status === "available" ? "cyan" : "mute"}>{i.status === "connected" ? "demo" : i.status}</Chip></div>
                <div className="mt-1 line-clamp-2 text-xs text-flw-mute">{i.description}</div>
                <div className="mt-2 font-mono text-[10px] text-flw-mute">{i.category} · {i.auth}</div>
              </li>
            ))}
          </ul>
          <p className="border-t border-flw-line/60 px-4 py-3 text-xs text-flw-mute">Connect flows are not active in the preview. Each external action will be authorised per tenant, audit-logged and protected by idempotency keys.</p>
        </Glass>
      </div>
    </>
  );
}
