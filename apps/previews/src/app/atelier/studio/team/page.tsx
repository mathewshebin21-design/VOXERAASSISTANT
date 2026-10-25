"use client";

import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { Button, Card, DemoNote, Eyebrow, field, H2, Pill, Title } from "@/components/atelier/ui";
import { TEAM } from "@/lib/demo-data";
import type { TeamMember } from "@/lib/types";

const ROLES: TeamMember["role"][] = ["Owner", "Admin", "Manager", "Viewer"];
const PERMS: [string, TeamMember["role"][]][] = [
  ["Read conversations", ["Owner", "Admin", "Manager", "Viewer"]],
  ["Edit the Notebook", ["Owner", "Admin", "Manager"]],
  ["Publish a new edition", ["Owner", "Admin"]],
  ["Manage connections & numbers", ["Owner", "Admin"]],
  ["Export or delete client data", ["Owner"]],
  ["Plan & billing", ["Owner"]],
];
const ACTIVITY = [
  ["16:02", "Mia Castell", "edited the Notebook", "Price list, edition 6 → 7", "plain"],
  ["15:41", "Ada Okafor", "published an edition", "Edition 5 · Warmer greeting", "champ"],
  ["14:10", "The studio", "refreshed a connection", "Google Calendar", "plain"],
  ["11:03", "The studio", "retried a delivery", "call.completed accepted on second attempt", "plain"],
  ["09:58", "Ada Okafor", "deleted a conversation", "call-0112, at the caller's request", "rose"],
  ["09:30", "Mia Castell", "signed in", "New device · Bristol", "plain"],
] as const;

export default function Team() {
  const [team, setTeam] = useState(TEAM);
  const [email, setEmail] = useState("");
  return (
    <div className="space-y-12">
      <div><Eyebrow>Team & activity</Eyebrow><Title className="mt-4">Who can do what — and what they did.</Title></div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-8">
          <H2>Your team</H2>
          <ul className="mt-6 divide-y divide-atl-line">
            {team.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-4 py-4">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-atl-bg font-serif text-lg ring-1 ring-atl-line">{m.name.split(" ").filter((x) => /^[A-Za-z]/.test(x)).map((x) => x[0]).join("").slice(0, 2)}</span>
                <div className="min-w-0 flex-1"><div className="font-medium">{m.name}</div><div className="truncate text-sm text-atl-soft">{m.email} · {m.lastActive}</div></div>
                <select aria-label={`Role for ${m.name}`} disabled={m.role === "Owner"} value={m.role} onChange={(e) => setTeam(team.map((x) => x.id === m.id ? { ...x, role: e.target.value as TeamMember["role"] } : x))} className="rounded-full border border-atl-line bg-atl-bg px-3 py-1.5 text-sm">
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (!/.+@.+\..+/.test(email)) return; setTeam([...team, { id: email, name: email.split("@")[0], email, role: "Viewer", lastActive: "Invited" }]); setEmail(""); }}>
            <input aria-label="Invite email" className={field} placeholder="colleague@yourstudio.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit">Invite</Button>
          </form>
          <div className="mt-3"><DemoNote>No invitation is sent in the preview.</DemoNote></div>
        </Card>
        <Card className="p-8">
          <H2>What each role may do</H2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.16em] text-atl-soft"><th className="pb-3 font-normal" />{ROLES.map((r) => <th key={r} className="pb-3 text-center font-normal">{r}</th>)}</tr></thead>
              <tbody>{PERMS.map(([p, roles]) => (
                <tr key={p} className="border-t border-atl-line"><td className="py-3">{p}</td>{ROLES.map((r) => <td key={r} className="text-center">{roles.includes(r) ? <Check size={16} className="mx-auto text-atl-sage" /> : <Minus size={14} className="mx-auto text-atl-line" />}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </div>
      <section>
        <H2>Today&apos;s activity</H2>
        <p className="mt-1 text-sm text-atl-soft">An unalterable record of every change and every sensitive action.</p>
        <ol className="mt-6 divide-y divide-atl-line border-y border-atl-line">
          {ACTIVITY.map(([t, who, what, detail, tone], i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4">
              <span className="w-14 font-serif text-xl">{t}</span>
              <span className="min-w-0 flex-1"><span className="font-medium">{who}</span> <span className="text-atl-soft">{what}</span><span className="block text-sm text-atl-soft">{detail}</span></span>
              <Pill tone={tone}>{tone === "rose" ? "sensitive" : tone === "champ" ? "change" : "routine"}</Pill>
            </li>
          ))}
        </ol>
        <div className="mt-3"><DemoNote>Illustrative entries. The real activity log is built in Phase 2.</DemoNote></div>
      </section>
    </div>
  );
}
