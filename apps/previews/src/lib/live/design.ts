"use client";

// Which of the three interfaces a person sees. One platform: same sign-in, API and data;
// only the presentation differs. The owner sets the workspace default; any member may
// choose a personal override (stored by the API, so it follows them across devices).

import { api } from "./api";
import { useActiveOrg, useApi } from "./session";

export type DesignId = "command" | "atelier" | "flow";

export interface DesignInfo {
  id: DesignId;
  name: string;
  line: string;
  bestFor: string;
  home: string;
  preview: string;
  swatch: string;
  recommended?: boolean;
}

export const DESIGNS: DesignInfo[] = [
  {
    id: "atelier",
    name: "VOXERA Atelier",
    line: "A calm, guided studio: your receptionist's personality, voice and setup in plain language.",
    bestFor: "Salons, clinics and independent businesses",
    home: "/atelier/studio",
    preview: "/atelier",
    swatch: "from-[#faf7f1] via-[#e4ddd0] to-[#c9aa78]",
    recommended: true,
  },
  {
    id: "command",
    name: "VOXERA Command",
    line: "An operations dashboard: call activity, bookings, analytics and staff in one dense view.",
    bestFor: "Multi-location businesses and operations teams",
    home: "/command/ops",
    preview: "/command",
    swatch: "from-[#09090c] via-[#1a1a21] to-[#8b5cf6]",
  },
  {
    id: "flow",
    name: "VOXERA Flow",
    line: "A visual workspace for designing conversations, configuring agents and following call flows.",
    bestFor: "Agencies, advanced users and automation specialists",
    home: "/flow/app",
    preview: "/flow",
    swatch: "from-[#05050a] via-[#a78bfa] to-[#67e8f9]",
  },
];

export const designById = (id: string | null | undefined) => DESIGNS.find((d) => d.id === id) ?? DESIGNS[0];

export interface DesignState {
  workspace_default: DesignId;
  my_override: DesignId | null;
  effective: DesignId;
  can_set_default: boolean;
}

/** The active workspace's design preference (null while loading or signed out). */
export function useDesign() {
  const org = useActiveOrg();
  const base = org ? `/orgs/${org.organization.id}/design` : null;
  const q = useApi<DesignState>(base);
  return {
    ...q,
    org,
    setDefault: async (design: DesignId) => {
      const s = await api<DesignState>(`${base}/default`, { method: "PUT", body: { design } });
      q.setData(s);
      return s;
    },
    setMine: async (design: DesignId | null) => {
      const s = await api<DesignState>(`${base}/me`, { method: "PUT", body: { design } });
      q.setData(s);
      return s;
    },
  };
}
