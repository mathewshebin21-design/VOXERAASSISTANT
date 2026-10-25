"use client";

import { clsx } from "clsx";
import { Download, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NeedsSignIn, Notice } from "@/components/flow/live-ui";
import { Chip, FBtn, finput, FSwitch, Glass, GHead, Heading } from "@/components/flow/ui";
import { api, ApiError, PERMS, type BusinessProfile, type HoursInterval, type Service, type WorkspaceSettings } from "@/lib/live/api";
import { useActiveOrg, useApi, useSession } from "@/lib/live/session";

const TABS = ["Profile", "Opening hours", "Services", "Settings", "Data & privacy"] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function useSaver() {
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ kind: "ok", text: ok }); } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Something went wrong" }); } finally { setBusy(false); }
  };
  return { msg, busy, run, setMsg };
}

export default function Workspace() {
  const status = useSession((s) => s.status);
  const active = useActiveOrg();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Profile");
  if (status === "loading") return <Heading kicker="Workspace" title="Loading…" />;
  if (status === "anonymous") return <><Heading kicker="Workspace" title="Your business" /><NeedsSignIn what="your business details" /></>;
  if (!active) return <NoWorkspace />;
  const canWrite = PERMS[active.role].write;
  const base = `/orgs/${active.organization.id}`;
  return (
    <>
      <Heading kicker="Workspace" title={active.organization.name}>
        <Chip tone="lime">live data</Chip><Chip>{active.role}</Chip>
      </Heading>
      {!canWrite && <div className="mb-4"><Notice>Your role ({active.role}) can view these settings but not change them.</Notice></div>}
      <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("whitespace-nowrap rounded-xl px-3.5 py-2 text-sm", tab === t ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute hover:text-flw-text")}>{t}</button>)}
      </div>
      {tab === "Profile" && <Profile base={base} canWrite={canWrite} />}
      {tab === "Opening hours" && <Hours base={base} canWrite={canWrite} />}
      {tab === "Services" && <Services base={base} canWrite={canWrite} />}
      {tab === "Settings" && <SettingsTab base={base} canWrite={canWrite} />}
      {tab === "Data & privacy" && <Privacy base={base} />}
    </>
  );
}

function Profile({ base, canWrite }: { base: string; canWrite: boolean }) {
  const { data, error } = useApi<BusinessProfile>(`${base}/business-profile`);
  const [f, setF] = useState<BusinessProfile | null>(null);
  const s = useSaver();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <Notice kind="error">{error.detail}</Notice>;
  if (!f) return <Notice>Loading…</Notice>;
  const field = (k: keyof BusinessProfile, label: string, ph = "") => (
    <label className="block text-xs text-flw-mute">{label}<input disabled={!canWrite} className={finput + " mt-1"} placeholder={ph} value={(f[k] as string | null) ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value || null })} /></label>
  );
  return (
    <Glass>
      <GHead title="Business profile" right={<span className="text-xs text-flw-mute">used by the receptionist when callers ask</span>} />
      <form className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void s.run(() => api(`${base}/business-profile`, { method: "PUT", body: { ...f, display_name: f.display_name } }), "Profile saved"); }}>
        {field("display_name", "Business name")}
        <label className="block text-xs text-flw-mute">Sector<select disabled={!canWrite} className={finput + " mt-1"} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })}>{[["hair_beauty", "Hair & beauty"], ["aesthetics", "Aesthetics (non-clinical)"], ["wellness", "Wellness & spa"], ["agency", "Agency"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {field("phone", "Phone", "+44 117 …")}
        {field("email", "Email", "hello@…")}
        {field("website", "Website (https://…)", "https://")}
        {field("address_line1", "Address line 1")}
        {field("address_line2", "Address line 2")}
        {field("city", "Town / city")}
        {field("postcode", "Postcode")}
        <label className="block text-xs text-flw-mute md:col-span-2">Description<textarea disabled={!canWrite} rows={3} className={finput + " mt-1"} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value || null })} /></label>
        <div className="flex items-center gap-3 md:col-span-2">
          {canWrite && <FBtn type="submit" variant="glow" disabled={s.busy}><Save size={14} /> Save profile</FBtn>}
          {s.msg && <Notice kind={s.msg.kind}>{s.msg.text}</Notice>}
        </div>
      </form>
    </Glass>
  );
}

function Hours({ base, canWrite }: { base: string; canWrite: boolean }) {
  const { data, error } = useApi<{ intervals: HoursInterval[] }>(`${base}/office-hours`);
  const [rows, setRows] = useState<HoursInterval[] | null>(null);
  const s = useSaver();
  useEffect(() => { if (data) setRows(data.intervals.map((i) => ({ ...i, opens_at: i.opens_at.slice(0, 5), closes_at: i.closes_at.slice(0, 5) }))); }, [data]);
  if (error) return <Notice kind="error">{error.detail}</Notice>;
  if (!rows) return <Notice>Loading…</Notice>;
  const set = (i: number, p: Partial<HoursInterval>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Glass>
      <GHead title="Opening hours" right={<span className="text-xs text-flw-mute">a day with no times is closed</span>} />
      <div className="divide-y divide-flw-line/60">
        {DAYS.map((day, d) => {
          const idx = rows.map((r, i) => [r, i] as const).filter(([r]) => r.weekday === d);
          return (
            <div key={day} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-24 text-sm">{day}</span>
              {idx.length === 0 && <span className="text-sm text-flw-mute">Closed</span>}
              {idx.map(([r, i]) => (
                <span key={i} className="flex items-center gap-1.5">
                  <input aria-label={`${day} opens`} type="time" disabled={!canWrite} value={r.opens_at} onChange={(e) => set(i, { opens_at: e.target.value })} className="rounded-lg border border-flw-line bg-flw-bg/70 px-2 py-1 font-mono text-xs" />
                  <span className="text-flw-mute">–</span>
                  <input aria-label={`${day} closes`} type="time" disabled={!canWrite} value={r.closes_at} onChange={(e) => set(i, { closes_at: e.target.value })} className="rounded-lg border border-flw-line bg-flw-bg/70 px-2 py-1 font-mono text-xs" />
                  {canWrite && <button aria-label={`Remove ${day} interval`} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-flw-mute hover:text-flw-pink"><Trash2 size={13} /></button>}
                </span>
              ))}
              {canWrite && <button onClick={() => setRows([...rows, { weekday: d, opens_at: "09:00", closes_at: "17:00" }])} className="ml-auto text-xs text-flw-cyan hover:underline" aria-label={`Add hours for ${day}`}>+ add</button>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-flw-line/60 p-4">
        {canWrite && <FBtn variant="glow" disabled={s.busy} onClick={() => s.run(() => api(`${base}/office-hours`, { method: "PUT", body: { intervals: rows } }), "Opening hours saved")}><Save size={14} /> Save hours</FBtn>}
        {s.msg && <Notice kind={s.msg.kind}>{s.msg.text}</Notice>}
      </div>
    </Glass>
  );
}

const EMPTY = { name: "", category: "", duration_min: 30, buffer_min: 0, price: "", bookable_by_agent: true, requires_patch_test: false };

function Services({ base, canWrite }: { base: string; canWrite: boolean }) {
  const { data, error, reload } = useApi<Service[]>(`${base}/services?include_inactive=true`);
  const [f, setF] = useState(EMPTY);
  const s = useSaver();
  const add = () => s.run(async () => {
    await api(`${base}/services`, { method: "POST", body: { name: f.name, category: f.category || null, duration_min: Number(f.duration_min), buffer_min: Number(f.buffer_min), price_from_pence: f.price === "" ? null : Math.round(Number(f.price) * 100), bookable_by_agent: f.bookable_by_agent, requires_patch_test: f.requires_patch_test } });
    setF(EMPTY); await reload();
  }, "Service added");
  const patch = (id: string, body: Partial<Service>) => s.run(async () => { await api(`${base}/services/${id}`, { method: "PATCH", body }); await reload(); }, "Service updated");
  const remove = (id: string) => s.run(async () => { await api(`${base}/services/${id}`, { method: "DELETE" }); await reload(); }, "Service removed");
  if (error) return <Notice kind="error">{error.detail}</Notice>;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <Glass>
        <GHead title="Service catalogue" right={<span className="text-xs text-flw-mute">{data?.length ?? 0} services</span>} />
        {!data ? <div className="p-4"><Notice>Loading…</Notice></div> : data.length === 0 ? <p className="p-4 text-sm text-flw-mute">No services yet. Add what callers can book.</p> : (
          <ul>{data.map((svc) => (
            <li key={svc.id} className={clsx("flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0", !svc.active && "opacity-50")}>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{svc.name}</div><div className="font-mono text-[11px] text-flw-mute">{svc.duration_min}m + {svc.buffer_min}m buffer · {svc.price_from_pence == null ? "price on request" : `from £${(svc.price_from_pence / 100).toFixed(2)}`}{svc.requires_patch_test ? " · patch test" : ""}</div></div>
              {svc.bookable_by_agent ? <Chip tone="cyan">agent-bookable</Chip> : <Chip>staff only</Chip>}
              {canWrite && <>
                <FBtn onClick={() => patch(svc.id, { active: !svc.active })}>{svc.active ? "Deactivate" : "Activate"}</FBtn>
                <button aria-label={`Delete ${svc.name}`} onClick={() => confirm(`Delete “${svc.name}”?`) && remove(svc.id)} className="text-flw-mute hover:text-flw-pink"><Trash2 size={14} /></button>
              </>}
            </li>
          ))}</ul>
        )}
      </Glass>
      {canWrite && (
        <Glass>
          <GHead title="Add a service" />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <label className="block text-xs text-flw-mute">Name<input required className={finput + " mt-1"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="block text-xs text-flw-mute">Category<input className={finput + " mt-1"} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs text-flw-mute">Minutes<input type="number" min={5} max={600} className={finput + " mt-1"} value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })} /></label>
              <label className="block text-xs text-flw-mute">Buffer<input type="number" min={0} max={120} className={finput + " mt-1"} value={f.buffer_min} onChange={(e) => setF({ ...f, buffer_min: Number(e.target.value) })} /></label>
              <label className="block text-xs text-flw-mute">From £<input type="number" min={0} step="0.01" className={finput + " mt-1"} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
            </div>
            <div className="flex items-center justify-between text-sm">Agent may book<FSwitch label="Agent may book" on={f.bookable_by_agent} onChange={(b) => setF({ ...f, bookable_by_agent: b })} /></div>
            <div className="flex items-center justify-between text-sm">Needs patch test<FSwitch label="Needs patch test" on={f.requires_patch_test} onChange={(b) => setF({ ...f, requires_patch_test: b })} /></div>
            <FBtn type="submit" variant="glow" disabled={s.busy || !f.name.trim()}><Plus size={14} /> Add service</FBtn>
            {s.msg && <Notice kind={s.msg.kind}>{s.msg.text}</Notice>}
          </form>
        </Glass>
      )}
    </div>
  );
}

function SettingsTab({ base, canWrite }: { base: string; canWrite: boolean }) {
  const { data, error } = useApi<WorkspaceSettings>(`${base}/settings`);
  const [f, setF] = useState<WorkspaceSettings | null>(null);
  const s = useSaver();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <Notice kind="error">{error.detail}</Notice>;
  if (!f) return <Notice>Loading…</Notice>;
  return (
    <Glass>
      <GHead title="Workspace settings" right={<Chip>data region: {f.data_region.toUpperCase()}</Chip>} />
      <form className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void s.run(() => api(`${base}/settings`, { method: "PATCH", body: { timezone: f.timezone, locale: f.locale, recording_disclosure_enabled: f.recording_disclosure_enabled, recording_disclosure_text: f.recording_disclosure_text, recording_retention_days: Number(f.recording_retention_days) } }), "Settings saved"); }}>
        <label className="block text-xs text-flw-mute">Time zone (IANA)<input disabled={!canWrite} list="tz" className={finput + " mt-1"} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
          <datalist id="tz">{["Europe/London", "Europe/Dublin", "Europe/Paris", "America/New_York"].map((z) => <option key={z} value={z} />)}</datalist></label>
        <label className="block text-xs text-flw-mute">Locale<select disabled={!canWrite} className={finput + " mt-1"} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}>{["en-GB", "en-IE", "en-US"].map((l) => <option key={l}>{l}</option>)}</select></label>
        <div className="flex items-center justify-between rounded-xl border border-flw-line p-3 text-sm">Play recording notice<FSwitch label="Recording notice" on={f.recording_disclosure_enabled} onChange={(b) => canWrite && setF({ ...f, recording_disclosure_enabled: b })} /></div>
        <label className="block text-xs text-flw-mute">Keep recordings & transcripts (days, 7–365)<input disabled={!canWrite} type="number" min={7} max={365} className={finput + " mt-1"} value={f.recording_retention_days} onChange={(e) => setF({ ...f, recording_retention_days: Number(e.target.value) })} /></label>
        <label className="block text-xs text-flw-mute md:col-span-2">Recording notice text<input disabled={!canWrite} className={finput + " mt-1"} value={f.recording_disclosure_text} onChange={(e) => setF({ ...f, recording_disclosure_text: e.target.value })} /></label>
        <div className="flex items-center gap-3 md:col-span-2">
          {canWrite && <FBtn type="submit" variant="glow" disabled={s.busy}><Save size={14} /> Save settings</FBtn>}
          {s.msg && <Notice kind={s.msg.kind}>{s.msg.text}</Notice>}
        </div>
      </form>
    </Glass>
  );
}

function Privacy({ base }: { base: string }) {
  const router = useRouter();
  const active = useActiveOrg()!;
  const { reloadOrgs, signOut } = useSession();
  const s = useSaver();
  const [confirmName, setConfirmName] = useState("");
  const [pw, setPw] = useState("");
  const isOwner = active.role === "owner";
  const download = (name: string, data: unknown) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = name;
    a.click();
  };
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Glass>
        <GHead title="Export" />
        <div className="space-y-3 p-4 text-sm text-flw-mute">
          <p>Download everything stored for this workspace (profile, hours, services, settings, agents, members, usage and the audit log) as JSON. Owner only; the export itself is audited.</p>
          <div className="flex flex-wrap gap-2">
            <FBtn disabled={!isOwner || s.busy} onClick={() => s.run(async () => download(`voxera-workspace-${active.organization.id}.json`, await api(`${base}/export`)), "Workspace export downloaded")}><Download size={14} /> Export workspace</FBtn>
            <FBtn disabled={s.busy} onClick={() => s.run(async () => download("voxera-my-data.json", await api("/me/export")), "Personal data downloaded")}><Download size={14} /> Export my personal data</FBtn>
          </div>
          {s.msg && <Notice kind={s.msg.kind}>{s.msg.text}</Notice>}
        </div>
      </Glass>
      <Glass>
        <GHead title="Delete" right={<Chip tone="pink">irreversible</Chip>} />
        <div className="space-y-4 p-4 text-sm text-flw-mute">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void s.run(async () => { await api(base, { method: "DELETE", body: { confirm_name: confirmName } }); await reloadOrgs(); router.push("/flow/app"); }, "Workspace deleted"); }}>
            <p>Delete <span className="text-flw-text">{active.organization.name}</span> and all of its data. Type the workspace name to confirm.</p>
            <input aria-label="Confirm workspace name" disabled={!isOwner} className={finput} placeholder={active.organization.name} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
            <FBtn type="submit" disabled={!isOwner || confirmName !== active.organization.name} className="border-flw-pink/50 text-flw-pink"><Trash2 size={14} /> Delete workspace</FBtn>
          </form>
          <form className="space-y-2 border-t border-flw-line/60 pt-4" onSubmit={(e) => { e.preventDefault(); void s.run(async () => { await api("/me", { method: "DELETE", body: { password: pw } }); await signOut(); router.push("/flow"); }, "Account deleted"); }}>
            <p>Delete your account. Workspaces where you are the only member are deleted with it; shared workspaces need another owner first.</p>
            <input aria-label="Your password" type="password" className={finput} placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <FBtn type="submit" disabled={!pw} className="border-flw-pink/50 text-flw-pink"><Trash2 size={14} /> Delete my account</FBtn>
          </form>
        </div>
      </Glass>
    </div>
  );
}

function NoWorkspace() {
  const router = useRouter();
  const { reloadOrgs, switchOrg, signOut } = useSession();
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const s = useSaver();
  return (
    <>
      <Heading kicker="Workspace" title="You have no workspaces" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Glass>
          <GHead title="Create a workspace" />
          <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); void s.run(async () => { const o = await api<{ id: string }>("/orgs", { method: "POST", body: { name } }); await reloadOrgs(); switchOrg(o.id); }, "Workspace created"); }}>
            <input aria-label="New workspace name" required className={finput} placeholder="Business name" value={name} onChange={(e) => setName(e.target.value)} />
            <FBtn type="submit" variant="glow"><Plus size={14} /> Create</FBtn>
          </form>
        </Glass>
        <Glass>
          <GHead title="Delete your account" right={<Chip tone="pink">irreversible</Chip>} />
          <form className="space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); void s.run(async () => { await api("/me", { method: "DELETE", body: { password: pw } }); await signOut(); router.push("/flow"); }, "Account deleted"); }}>
            <input aria-label="Your password" type="password" className={finput} placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <FBtn type="submit" disabled={!pw} className="border-flw-pink/50 text-flw-pink"><Trash2 size={14} /> Delete my account</FBtn>
          </form>
        </Glass>
      </div>
      {s.msg && <div className="mt-4"><Notice kind={s.msg.kind}>{s.msg.text}</Notice></div>}
    </>
  );
}
