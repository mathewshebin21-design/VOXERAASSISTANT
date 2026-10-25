"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Btn, inputCls, PageHead, Panel, Tag } from "@/components/command/ui";
import { TEAM } from "@/lib/demo-data";
import type { TeamMember } from "@/lib/types";

const PERMS: [string, TeamMember["role"][]][] = [
  ["View calls & transcripts", ["Owner", "Admin", "Manager", "Viewer"]],
  ["Edit knowledge", ["Owner", "Admin", "Manager"]],
  ["Publish agent versions", ["Owner", "Admin"]],
  ["Manage integrations & numbers", ["Owner", "Admin"]],
  ["Export / delete customer data", ["Owner"]],
  ["Billing", ["Owner"]],
];

const AUDIT = [
  ["16:02", "Mia Castell", "knowledge.update", "kb-prices v6 → v7"],
  ["15:41", "Ada Okafor", "agent.publish", "v5 · Warmer greeting"],
  ["14:10", "System", "integration.token_refresh", "Google Calendar"],
  ["11:03", "System", "webhook.retry", "call.completed → 200 on attempt 2"],
  ["09:58", "Ada Okafor", "transcript.delete", "call-0112 (caller request)"],
  ["09:30", "Mia Castell", "auth.login", "new device · Bristol, UK"],
];

export default function Team() {
  const [team, setTeam] = useState(TEAM);
  const [email, setEmail] = useState("");
  return (
    <>
      <PageHead kicker="Admin · access" title="Team & audit log" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Members" dense>
          <ul>{team.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 border-t border-cmd-line px-4 py-3 first:border-0">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-cmd-raised font-mono text-[11px]">{m.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.name}</div><div className="truncate font-mono text-[11px] text-cmd-mute">{m.email}</div></div>
              <select aria-label={`Role for ${m.name}`} disabled={m.role === "Owner"} className={inputCls + " w-auto"} value={m.role} onChange={(e) => setTeam(team.map((x) => x.id === m.id ? { ...x, role: e.target.value as TeamMember["role"] } : x))}>
                {["Owner", "Admin", "Manager", "Viewer"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </li>
          ))}</ul>
          <form className="flex gap-2 border-t border-cmd-line p-3" onSubmit={(e) => { e.preventDefault(); if (!/.+@.+\..+/.test(email)) return; setTeam([...team, { id: email, name: email.split("@")[0], email, role: "Viewer", lastActive: "Invited" }]); setEmail(""); }}>
            <input className={inputCls} placeholder="colleague@business.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Invite email" />
            <Btn type="submit" variant="primary"><UserPlus size={14} /> Invite</Btn>
          </form>
          <p className="px-4 pb-3 text-[11px] text-cmd-mute">Preview: no invitation email is sent.</p>
        </Panel>
        <Panel title="Role permissions" dense>
          <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
            <thead className="font-mono text-[10px] uppercase text-cmd-mute"><tr><th className="px-4 py-2 text-left font-normal">Permission</th>{["Owner", "Admin", "Manager", "Viewer"].map((r) => <th key={r} className="px-2 font-normal">{r}</th>)}</tr></thead>
            <tbody>{PERMS.map(([p, roles]) => (
              <tr key={p} className="border-t border-cmd-line"><td className="px-4 py-2">{p}</td>{(["Owner", "Admin", "Manager", "Viewer"] as const).map((r) => <td key={r} className="text-center">{roles.includes(r) ? <span className="text-cmd-ok">●</span> : <span className="text-cmd-line">○</span>}</td>)}</tr>
            ))}</tbody>
          </table></div>
        </Panel>
        <Panel title="Audit log · today" dense className="xl:col-span-2">
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] font-mono text-[12px]">
            <tbody>{AUDIT.map(([t, who, ev, detail], i) => (
              <tr key={i} className="border-t border-cmd-line first:border-0"><td className="px-4 py-2 text-cmd-mute">{t}</td><td>{who}</td><td><Tag tone={ev.startsWith("transcript") ? "warn" : ev.startsWith("agent") ? "violet" : "mute"}>{ev}</Tag></td><td className="px-4 text-cmd-mute">{detail}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="border-t border-cmd-line px-4 py-2 text-[11px] text-cmd-mute">Append-only, tenant-scoped audit events (Phase 2). Entries above are illustrative.</p>
        </Panel>
      </div>
    </>
  );
}
