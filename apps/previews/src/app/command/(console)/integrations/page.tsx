"use client";

import { clsx } from "clsx";
import { CheckCircle2, CircleDashed, Clock, KeyRound } from "lucide-react";
import { useState } from "react";
import { Btn, PageHead, Panel, Tag } from "@/components/command/ui";
import { INTEGRATIONS } from "@/lib/demo-data";
import type { Integration } from "@/lib/types";

const WEBHOOK_LOG = [
  ["09:14:02", "call.completed", "200", "1"], ["09:14:03", "appointment.created", "200", "1"], ["11:02:41", "call.completed", "502", "1"],
  ["11:02:46", "call.completed", "200", "2 (retry)"], ["13:30:10", "message.taken", "200", "1"],
];

export default function Integrations() {
  const [sel, setSel] = useState<Integration>(INTEGRATIONS[0]);
  const groups = [...new Set(INTEGRATIONS.map((i) => i.category))];
  return (
    <>
      <PageHead kicker="Admin · connections" title="Integrations"><Tag tone="warn">No real connections in preview</Tag></PageHead>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {groups.map((g) => (
            <Panel key={g} title={g} dense>
              <ul>
                {INTEGRATIONS.filter((i) => i.category === g).map((i) => (
                  <li key={i.id}>
                    <button onClick={() => setSel(i)} className={clsx("flex w-full items-center gap-3 border-t border-cmd-line px-4 py-3 text-left first:border-0", sel.id === i.id ? "bg-cmd-violet/10" : "hover:bg-cmd-raised")}>
                      {i.status === "connected" ? <CheckCircle2 size={16} className="text-cmd-ok" /> : i.status === "available" ? <CircleDashed size={16} className="text-cmd-cyan" /> : <Clock size={16} className="text-cmd-mute" />}
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{i.name}</div><div className="truncate text-xs text-cmd-mute">{i.description}</div></div>
                      <Tag tone={i.status === "connected" ? "ok" : i.status === "available" ? "cyan" : "mute"}>{i.status === "connected" ? "connected (demo)" : i.status}</Tag>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
        <div className="space-y-4">
          <Panel title={sel.name}>
            <p className="text-sm text-cmd-mute">{sel.description}</p>
            <dl className="mt-3 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between"><dt className="text-cmd-mute">auth</dt><dd>{sel.auth}</dd></div>
              <div className="flex justify-between"><dt className="text-cmd-mute">scopes</dt><dd>{sel.scopes?.join(", ") ?? "least-privilege, set at connect"}</dd></div>
              <div className="flex justify-between"><dt className="text-cmd-mute">secrets</dt><dd>server-side vault, per tenant</dd></div>
            </dl>
            <div className="mt-4 flex gap-2">
              {sel.status === "connected" ? <Btn variant="danger" disabled title="Preview only">Disconnect</Btn> : <Btn variant="primary" disabled={sel.status === "planned"} title="Opens the provider's consent screen in production"><KeyRound size={14} /> {sel.status === "planned" ? "Planned" : "Connect"}</Btn>}
            </div>
            <p className="mt-3 text-xs text-cmd-mute">Connect buttons are inert in the preview. OAuth flows, token storage and scope review are built in Phase 8.</p>
          </Panel>
          <Panel title="Outbound webhook deliveries (demo)" dense>
            <table className="w-full font-mono text-[11px]">
              <tbody>{WEBHOOK_LOG.map(([t, e, code, attempt], i) => (
                <tr key={i} className="border-t border-cmd-line first:border-0"><td className="px-3 py-1.5 text-cmd-mute">{t}</td><td>{e}</td><td className={code === "200" ? "text-cmd-ok" : "text-cmd-bad"}>{code}</td><td className="px-3 text-right text-cmd-mute">#{attempt}</td></tr>
              ))}</tbody>
            </table>
            <p className="border-t border-cmd-line px-3 py-2 text-[11px] text-cmd-mute">HMAC-SHA256 signed · retries with exponential back-off · same event ID on retry so receivers can de-duplicate.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
