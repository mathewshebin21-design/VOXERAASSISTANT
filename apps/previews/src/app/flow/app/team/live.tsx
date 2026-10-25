"use client";

import { Copy, Mail, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtWhen, Notice } from "@/components/flow/live-ui";
import { Chip, FBtn, finputAuto, Glass, GHead, Heading } from "@/components/flow/ui";
import { api, ApiError, PERMS, type AuditEntry, type Invitation, type Member, type Role } from "@/lib/live/api";
import { useActiveOrg, useApi, useSession } from "@/lib/live/session";

const ROLES: Role[] = ["owner", "admin", "manager", "viewer"];

export function LiveTeam() {
  const active = useActiveOrg()!;
  const me = useSession((s) => s.user);
  const reloadOrgs = useSession((s) => s.reloadOrgs);
  const router = useRouter();
  const base = `/orgs/${active.organization.id}`;
  const perms = PERMS[active.role];
  const members = useApi<Member[]>(`${base}/members`);
  const invites = useApi<Invitation[]>(perms.members ? `${base}/invitations` : null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditMore, setAuditMore] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [link, setLink] = useState<string | null>(null);

  const loadAudit = async (before?: string) => {
    const page = await api<AuditEntry[]>(`${base}/audit-logs?limit=25${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    setAudit((a) => (before ? [...a, ...page] : page));
    setAuditMore(page.length === 25);
  };
  useEffect(() => { if (perms.audit) void loadAudit(); else setAudit([]); }, [base, perms.audit]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ kind: "ok", text: ok }); await Promise.all([members.reload(), invites.reload(), perms.audit ? loadAudit() : undefined]); }
    catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Something went wrong" }); }
  };
  const nameOf = (id: string | null) => (id ? members.data?.find((m) => m.user_id === id)?.full_name ?? "Former member" : "System");

  return (
    <>
      <Heading kicker="Team" title="Access & audit"><Chip tone="lime">live data</Chip><Chip>you are {active.role}</Chip></Heading>
      {msg && <div className="mb-4"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Glass>
          <GHead title="Members" right={<span className="text-xs text-flw-mute">{members.data?.length ?? "…"}</span>} />
          {members.error && <div className="p-4"><Notice kind="error">{members.error.detail}</Notice></div>}
          <ul>{members.data?.map((m) => {
            const self = m.user_id === me?.id;
            const canEdit = perms.members && (perms.owner || m.role !== "owner");
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-flw-violet/40 to-flw-cyan/40 text-xs font-semibold">{m.full_name.split(" ").filter((x) => /^[A-Za-z]/.test(x)).map((x) => x[0]).join("").slice(0, 2)}</span>
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.full_name}{self && <span className="ml-1 text-xs text-flw-mute">(you)</span>}</div><div className="truncate font-mono text-[11px] text-flw-mute">{m.email} · joined {fmtWhen(m.joined_at)}</div></div>
                {canEdit ? (
                  <select aria-label={`Role for ${m.full_name}`} className={finputAuto} value={m.role} onChange={(e) => run(() => api(`${base}/members/${m.user_id}`, { method: "PATCH", body: { role: e.target.value } }), "Role updated")}>
                    {ROLES.filter((r) => perms.owner || r !== "owner").map((r) => <option key={r}>{r}</option>)}
                  </select>
                ) : <Chip>{m.role}</Chip>}
                {(self || canEdit) && (
                  <button aria-label={self ? "Leave workspace" : `Remove ${m.full_name}`} title={self ? "Leave workspace" : "Remove"} className="text-flw-mute hover:text-flw-pink"
                    onClick={() => confirm(self ? "Leave this workspace?" : `Remove ${m.full_name}?`) && run(async () => { await api(`${base}/members/${m.user_id}`, { method: "DELETE" }); if (self) { await reloadOrgs(); router.push("/flow/app"); } }, self ? "You left the workspace" : "Member removed")}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}</ul>
        </Glass>

        <Glass>
          <GHead title="Invitations" />
          {!perms.members ? <p className="p-4 text-sm text-flw-mute">Only owners and admins can invite people.</p> : (
            <>
              <form className="flex flex-wrap gap-2 p-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
                const inv = await api<Invitation>(`${base}/invitations`, { method: "POST", body: { email, role } });
                setLink(inv.token ? `${window.location.origin}/flow/invite?token=${encodeURIComponent(inv.token)}` : null);
                setEmail("");
              }, "Invitation created"); }}>
                <input aria-label="Invite email" type="email" required className={finputAuto + " min-w-[200px] flex-1"} placeholder="colleague@business.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} />
                <select aria-label="Invite role" className={finputAuto} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.filter((r) => perms.owner || r !== "owner").map((r) => <option key={r}>{r}</option>)}</select>
                <FBtn type="submit" variant="glow"><UserPlus size={14} /> Invite</FBtn>
              </form>
              {link && (
                <div className="mx-3 mb-3 rounded-xl border border-flw-cyan/30 bg-flw-cyan/5 p-3 text-xs">
                  <div className="flex items-center gap-2 text-flw-cyan"><Mail size={13} /> Development mode: emails aren&apos;t sent yet, so share this one-time link.</div>
                  <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 truncate font-mono text-[11px] text-flw-text" data-testid="invite-link">{link}</code>
                    <button aria-label="Copy invite link" onClick={() => navigator.clipboard?.writeText(link)} className="text-flw-mute hover:text-flw-text"><Copy size={13} /></button></div>
                </div>
              )}
              <ul>{invites.data?.map((i) => {
                const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span><Chip>{i.role}</Chip>
                    <Chip tone={state === "accepted" ? "lime" : state === "pending" ? "cyan" : "mute"}>{state}</Chip>
                    {state === "pending" && <button className="text-xs text-flw-mute hover:text-flw-pink" onClick={() => run(() => api(`${base}/invitations/${i.id}`, { method: "DELETE" }), "Invitation revoked")}>revoke</button>}
                  </li>
                );
              })}</ul>
            </>
          )}
        </Glass>

        <Glass className="xl:col-span-2">
          <GHead title="Audit log" right={<Chip>append-only · stored by the API</Chip>} />
          {!perms.audit ? <p className="p-4 text-sm text-flw-mute">Only owners and admins can read the audit log.</p> : (
            <>
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs">
                <tbody>{audit.map((a) => (
                  <tr key={a.id} className="border-t border-flw-line/60 first:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-flw-mute">{fmtWhen(a.created_at)}</td>
                    <td className="px-2">{nameOf(a.actor_user_id)}</td>
                    <td className="px-2"><Chip tone={a.action.includes("delete") || a.action.includes("removed") ? "pink" : a.action.startsWith("agent") ? "violet" : "mute"}>{a.action}</Chip></td>
                    <td className="max-w-[420px] truncate px-4 font-mono text-[11px] text-flw-mute" title={JSON.stringify(a.details)}>{Object.keys(a.details).length ? JSON.stringify(a.details) : a.target_type ?? ""}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {auditMore && audit.length > 0 && <button onClick={() => loadAudit(audit[audit.length - 1].created_at)} className="w-full border-t border-flw-line/60 py-2 text-xs text-flw-cyan">load older</button>}
            </>
          )}
        </Glass>
      </div>
    </>
  );
}
