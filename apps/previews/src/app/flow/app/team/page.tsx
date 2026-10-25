"use client";

import { Check, Minus, UserPlus } from "lucide-react";
import { LiveTeam } from "./live";
import { useActiveOrg, useSession } from "@/lib/live/session";
import { useState } from "react";
import { Chip, FBtn, finput, finputAuto, Glass, GHead, Heading } from "@/components/flow/ui";
import { TEAM } from "@/lib/demo-data";
import type { TeamMember } from "@/lib/types";

const ROLES: TeamMember["role"][] = ["Owner", "Admin", "Manager", "Viewer"];
const PERMS: [string, TeamMember["role"][]][] = [
  ["View calls & transcripts", ["Owner", "Admin", "Manager", "Viewer"]],
  ["Edit knowledge", ["Owner", "Admin", "Manager"]],
  ["Publish agent versions", ["Owner", "Admin"]],
  ["Manage integrations & numbers", ["Owner", "Admin"]],
  ["Export / delete customer data", ["Owner"]],
  ["Billing", ["Owner"]],
];
const AUDIT = [
  ["16:02", "Mia Castell", "knowledge.update", "kb-prices v6 → v7", "mute"],
  ["15:41", "Ada Okafor", "agent.publish", "v5 · Warmer greeting", "violet"],
  ["14:10", "System", "integration.token_refresh", "Google Calendar", "mute"],
  ["11:03", "System", "webhook.retry", "call.completed → 200 on attempt 2", "mute"],
  ["09:58", "Ada Okafor", "transcript.delete", "call-0112 (caller request)", "pink"],
  ["09:30", "Mia Castell", "auth.login", "new device · Bristol, UK", "mute"],
] as const;

function DemoTeam() {
  const [team, setTeam] = useState(TEAM);
  const [email, setEmail] = useState("");
  return (
    <>
      <Heading kicker="Team" title="Access & audit" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Glass>
          <GHead title="Members" />
          <ul>{team.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-flw-violet/40 to-flw-cyan/40 text-xs font-semibold">{m.name.split(" ").filter((x) => /^[A-Za-z]/.test(x)).map((x) => x[0]).join("").slice(0, 2)}</span>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.name}</div><div className="truncate font-mono text-[11px] text-flw-mute">{m.email} · {m.lastActive}</div></div>
              <select aria-label={`Role for ${m.name}`} disabled={m.role === "Owner"} className={finputAuto} value={m.role} onChange={(e) => setTeam(team.map((x) => x.id === m.id ? { ...x, role: e.target.value as TeamMember["role"] } : x))}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </li>
          ))}</ul>
          <form className="flex gap-2 border-t border-flw-line/60 p-3" onSubmit={(e) => { e.preventDefault(); if (!/.+@.+\..+/.test(email)) return; setTeam([...team, { id: email, name: email.split("@")[0], email, role: "Viewer", lastActive: "Invited" }]); setEmail(""); }}>
            <input aria-label="Invite email" className={finput} placeholder="colleague@business.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FBtn type="submit" variant="glow"><UserPlus size={14} /> Invite</FBtn>
          </form>
          <p className="px-4 pb-3 text-[11px] text-flw-mute">Preview: no invitation is sent.</p>
        </Glass>
        <Glass>
          <GHead title="Role permissions" />
          <div className="overflow-x-auto p-2"><table className="w-full min-w-[460px] text-sm">
            <thead className="text-xs text-flw-mute"><tr><th className="px-3 py-2 text-left font-normal">Permission</th>{ROLES.map((r) => <th key={r} className="px-2 font-normal">{r}</th>)}</tr></thead>
            <tbody>{PERMS.map(([p, roles]) => <tr key={p} className="border-t border-flw-line/60"><td className="px-3 py-2">{p}</td>{ROLES.map((r) => <td key={r} className="text-center">{roles.includes(r) ? <Check size={15} className="mx-auto text-flw-lime" /> : <Minus size={13} className="mx-auto text-flw-line" />}</td>)}</tr>)}</tbody>
          </table></div>
        </Glass>
        <Glass className="xl:col-span-2">
          <GHead title="Audit log · today" right={<Chip>append-only</Chip>} />
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] font-mono text-xs">
            <tbody>{AUDIT.map(([t, who, ev, detail, tone], i) => (
              <tr key={i} className="border-t border-flw-line/60 first:border-0"><td className="px-4 py-2 text-flw-mute">{t}</td><td>{who}</td><td><Chip tone={tone}>{ev}</Chip></td><td className="px-4 text-flw-mute">{detail}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="border-t border-flw-line/60 px-4 py-2 text-[11px] text-flw-mute">Illustrative entries — tenant-scoped audit events are implemented in Phase 2.</p>
        </Glass>
      </div>
    </>
  );
}

export default function Team() {
  const status = useSession((s) => s.status);
  const active = useActiveOrg();
  if (status === "loading") return <Heading kicker="Team" title="Loading…" />;
  return active ? <LiveTeam /> : <><DemoTeam /><p className="mt-4 text-xs text-flw-mute">Demo team. <a href="/flow/enter" className="text-flw-cyan underline">Sign in</a> to manage a real workspace.</p></>;
}
