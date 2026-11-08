"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { api, ApiError, session as sessionCall, type MyOrg, type User } from "./api";

type Status = "loading" | "anonymous" | "signed_in";

interface SessionState {
  status: Status;
  user: User | null;
  orgs: MyOrg[];
  activeOrgId: string | null;
  /** Set when the user is signed in but their workspaces could not be loaded (never silently "none"). */
  orgsError: string | null;
  load: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (b: { email: string; password: string; full_name: string; organization_name: string }) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrg: (id: string) => void;
  reloadOrgs: () => Promise<void>;
}

const ORG_KEY = "voxera-active-org";
const readOrg = () => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } };
const writeOrg = (id: string | null) => { try { if (id) localStorage.setItem(ORG_KEY, id); else localStorage.removeItem(ORG_KEY); } catch { /* storage unavailable */ } };

export const useSession = create<SessionState>()((set, get) => ({
  status: "loading",
  user: null,
  orgs: [],
  activeOrgId: null,
  orgsError: null,
  load: async () => {
    const r = await fetch("/api/session/me", { cache: "no-store" }).catch(() => null);
    const user = r?.ok ? ((await r.json()) as { user: User | null }).user : null;
    if (!user) { set({ status: "anonymous", user: null, orgs: [], activeOrgId: null, orgsError: null }); return; }
    let orgs: MyOrg[];
    try {
      orgs = await api<MyOrg[]>("/me/organizations");
    } catch (e) {
      // Signed in, but the workspace list failed: say so instead of pretending there are none.
      // The saved workspace choice is kept so a retry can restore it.
      set({ status: "signed_in", user, orgs: [], activeOrgId: null, orgsError: e instanceof ApiError ? e.detail : "Network error" });
      return;
    }
    const saved = readOrg();
    const activeOrgId = orgs.find((o) => o.organization.id === saved)?.organization.id ?? orgs[0]?.organization.id ?? null;
    writeOrg(activeOrgId);
    set({ status: "signed_in", user, orgs, activeOrgId, orgsError: null });
  },
  signIn: async (email, password) => { await sessionCall("login", { email, password }); await get().load(); },
  signUp: async (b) => { await sessionCall("signup", b); writeOrg(null); await get().load(); },
  signOut: async () => { await sessionCall("logout").catch(() => undefined); writeOrg(null); set({ status: "anonymous", user: null, orgs: [], activeOrgId: null, orgsError: null }); },
  switchOrg: (id) => { writeOrg(id); set({ activeOrgId: id }); },
  reloadOrgs: async () => {
    const orgs = await api<MyOrg[]>("/me/organizations");
    const cur = get().activeOrgId;
    const activeOrgId = orgs.find((o) => o.organization.id === cur) ? cur : orgs[0]?.organization.id ?? null;
    writeOrg(activeOrgId);
    set({ orgs, activeOrgId, orgsError: null });
  },
}));

/** The active workspace and the signed-in user's role in it (null in demo mode). */
export function useActiveOrg() {
  const { orgs, activeOrgId } = useSession();
  return orgs.find((o) => o.organization.id === activeOrgId) ?? null;
}

/** Minimal data hook: fetches `path` when it is non-null, exposes reload and errors. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "Network error"));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
