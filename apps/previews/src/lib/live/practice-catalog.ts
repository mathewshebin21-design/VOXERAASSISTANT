"use client";

// Loads the signed-in workspace's details for the free practice receptionist.

import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type BusinessProfile, type HoursInterval, type Service, type WorkspaceSettings } from "./api";
import { useDataMode } from "./data-mode";
import type { Catalog, SlotFinder } from "./practice";

export interface PracticeSetup { catalog: Catalog; greeting: string | null; recording: string | null }

export function toCatalog(o: { name: string; profile: BusinessProfile; settings: WorkspaceSettings | null; hours: HoursInterval[]; services: Service[]; agents: Agent[] }): PracticeSetup {
  const p = o.profile;
  const agent = o.agents.find((a) => a.status === "live") ?? o.agents[0];
  const address = [p.address_line1, p.address_line2, p.city, p.postcode].filter(Boolean).join(", ") || null;
  return {
    catalog: {
      business: p.display_name || o.name,
      agentName: agent?.name ?? "the receptionist",
      timezone: o.settings?.timezone ?? "Europe/London",
      services: o.services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, category: s.category, durationMin: s.duration_min, pricePence: s.price_from_pence, requiresPatchTest: s.requires_patch_test, bookable: s.bookable_by_agent })),
      hours: o.hours.map((h) => ({ weekday: h.weekday, opens: h.opens_at.slice(0, 5), closes: h.closes_at.slice(0, 5) })),
      address,
      phone: p.phone,
      email: p.email,
      website: p.website,
      description: p.description,
      allowTransfer: true,
    },
    greeting: agent?.greeting ?? null,
    recording: o.settings?.recording_disclosure_enabled ? o.settings.recording_disclosure_text : null,
  };
}

/** The workspace's catalog when signed in (null in demo mode or while loading). */
export function usePracticeSetup() {
  const { mode, org } = useDataMode();
  const orgId = mode === "live" ? org?.organization.id : undefined;
  const [setup, setSetup] = useState<PracticeSetup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !org) { setSetup(null); return; }
    const b = `/orgs/${orgId}`;
    const get = <T,>(path: string, fallback: T) => api<T>(path).catch(() => fallback);
    try {
      const profile = await api<BusinessProfile>(`${b}/business-profile`);
      const [settings, hours, services, agents] = await Promise.all([
        get<WorkspaceSettings | null>(`${b}/settings`, null),
        get<{ intervals: HoursInterval[] }>(`${b}/office-hours`, { intervals: [] }),
        get<Service[]>(`${b}/services`, []),
        get<Agent[]>(`${b}/agents`, []),
      ]);
      setSetup(toCatalog({ name: org.organization.name, profile, settings, hours: hours.intervals, services, agents }));
      setError(null);
    } catch (e) {
      setSetup(null);
      setError(e instanceof Error ? e.message : "Couldn't load your workspace");
    }
  }, [orgId, org]);
  useEffect(() => { void load(); }, [load]);

  const findSlots: SlotFinder = useCallback(async (serviceId, on) => {
    const q = new URLSearchParams({ service_id: serviceId, ...(on ? { on } : {}) });
    const r = await api<{ slots: string[] }>(`/orgs/${orgId}/availability?${q}`);
    return r.slots;
  }, [orgId]);

  return { mode, orgId: setup ? orgId : undefined, setup, error, findSlots, reload: load };
}
