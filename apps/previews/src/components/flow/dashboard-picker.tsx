"use client";

import { clsx } from "clsx";
import { LayoutDashboard } from "lucide-react";
import { Glass, GHead } from "./ui";
import { DASHBOARDS, dashboardById, dashboardFor, sectorFor, type DashboardId, type DashboardTemplate } from "@/lib/dashboards";
import { api, PERMS, type BusinessProfile } from "@/lib/live/api";
import { useActiveOrg, useApi } from "@/lib/live/session";
import { usePreview } from "@/lib/store";

/** Picks the dashboard: a signed-in workspace's sector, otherwise the demo choice. */
export function useDashboard(): { tpl: DashboardTemplate; chosen: boolean; choose: (id: DashboardId) => Promise<void>; saveNote: string | null } {
  const active = useActiveOrg();
  const base = active ? `/orgs/${active.organization.id}` : null;
  const profile = useApi<BusinessProfile>(base ? `${base}/business-profile` : null);
  const local = usePreview((s) => s.dashboard);
  const setLocal = usePreview((s) => s.setDashboard);
  const canWrite = !!active && PERMS[active.role].write;
  const tpl = profile.data ? dashboardFor(profile.data.sector) : dashboardById(local) ?? DASHBOARDS[0];
  const choose = async (id: DashboardId) => {
    setLocal(id);
    if (base && canWrite && profile.data) {
      const updated = await api<BusinessProfile>(`${base}/business-profile`, { method: "PUT", body: { ...profile.data, sector: sectorFor(id) } });
      profile.setData(updated);
    }
  };
  const saveNote = active && !canWrite ? "Only owners and admins can change the workspace’s business type; this choice applies on this device." : null;
  return { tpl: active && profile.data && !canWrite && local ? dashboardById(local)! : tpl, chosen: !!profile.data || !!local, choose, saveNote };
}

export function Picker({ tpl, choose, note, onDone }: { tpl: DashboardTemplate; choose: (id: DashboardId) => Promise<void>; note: string | null; onDone: () => void }) {
  return (
    <Glass glow="cyan" className="mb-4">
      <GHead title={<span className="flex items-center gap-2"><LayoutDashboard size={14} /> Choose the dashboard that fits your business</span>} right={<button onClick={onDone} className="text-xs text-flw-mute hover:text-flw-text">close</button>} />
      <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Dashboard type">
        {DASHBOARDS.map((d) => (
          <button key={d.id} role="radio" aria-checked={d.id === tpl.id} onClick={() => void choose(d.id).then(onDone)} className={clsx("rounded-xl border p-3 text-left transition", d.id === tpl.id ? "border-flw-cyan bg-flw-cyan/10" : "border-flw-line hover:border-flw-violet/60")}>
            <div className="font-display text-sm font-medium">{d.label}</div>
            <div className="mt-0.5 text-[11px] text-flw-mute">{d.examples}</div>
            <div className="mt-2 text-xs">{d.focus}</div>
          </button>
        ))}
      </div>
      <p className="px-4 pb-4 text-[11px] text-flw-mute">The layout and wording change with the business type; you can switch at any time. {note}</p>
    </Glass>
  );
}

