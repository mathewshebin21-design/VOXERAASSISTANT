"use client";

// Which data a screen shows: the signed-in workspace's real records ("live"), or the
// synthetic demo salon ("demo"). Demo is an explicit, separate choice ("Explore with
// demo data"); a signed-in user can switch to it and back without signing out.

import { create } from "zustand";
import { useActiveOrg, useSession } from "./session";

const KEY = "voxera-view-demo";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export const useDemoView = create<{ on: boolean; hydrated: boolean; set: (on: boolean) => void; hydrate: () => void }>()((set) => ({
  on: false,
  hydrated: false,
  set: (on) => { try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } set({ on }); },
  hydrate: () => set({ on: read(), hydrated: true }),
}));

export type DataMode = "loading" | "live" | "demo";

export function useDataMode() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const org = useActiveOrg();
  const demo = useDemoView();
  const signedIn = status === "signed_in";
  const mode: DataMode = status === "loading" || !demo.hydrated ? "loading" : signedIn && org && !demo.on ? "live" : "demo";
  return {
    mode,
    signedIn,
    user,
    org,
    /** Signed in, but looking at the demo on purpose. */
    viewingDemo: signedIn && demo.on,
    exploreDemo: () => demo.set(true),
    backToWorkspace: () => demo.set(false),
  };
}
