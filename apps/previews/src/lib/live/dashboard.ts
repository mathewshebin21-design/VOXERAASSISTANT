"use client";

// Real-workspace dashboard data for Command (A) and Atelier (B): one parallel fetch of
// what the API holds, summarised by a pure function (unit-tested) so both designs show
// the same numbers in their own look. Calls only exist once a phone line is connected
// (Phase 4), so call figures are deliberately absent rather than invented.

import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type Appointment, type BusinessProfile, type DeskCase, type DeskMember, type HoursInterval, type Member, type Service, type UsageSummary, type WorkspaceSettings } from "./api";

export interface VoiceTestSession { id: string; started_at: string; summary: { turns: number; time_to_first_audio_ms: number | null } }

export interface DashboardInput {
  profile: BusinessProfile | null;
  settings: WorkspaceSettings | null;
  hours: HoursInterval[];
  services: Service[];
  agents: Agent[];
  members: Member[];
  appointments: Appointment[];
  queue: DeskCase[];
  inProgress: DeskCase[];
  resolved: DeskCase[];
  team: DeskMember[];
  usage: UsageSummary | null;
  voiceSessions: VoiceTestSession[];
}

export interface SetupStep { id: string; label: string; done: boolean; href: string }

export interface WorkspaceSummary {
  timezone: string;
  businessName: string;
  agentName: string | null;
  upcoming: Appointment[];
  today: Appointment[];
  next7Days: number;
  bookedByAi: number;
  waiting: DeskCase[];
  inProgress: number;
  urgent: number;
  resolved7Days: number;
  teamAvailable: number;
  teamOnDesk: number;
  setup: SetupStep[];
  setupDone: number;
  /** Nothing has happened in this workspace yet: show a welcome rather than empty charts. */
  isNew: boolean;
  usage: UsageSummary | null;
  voiceSessions: VoiceTestSession[];
}

const dayIn = (iso: string | Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(typeof iso === "string" ? new Date(iso) : iso);

export function summarise(d: DashboardInput, now: Date = new Date()): WorkspaceSummary {
  const tz = d.settings?.timezone ?? "Europe/London";
  const t = now.getTime();
  const booked = d.appointments.filter((a) => a.status === "booked");
  const upcoming = booked.filter((a) => new Date(a.ends_at).getTime() > t).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const todayKey = dayIn(now, tz);
  const weekAgo = t - 7 * 86400000;
  const setup: SetupStep[] = [
    { id: "profile", label: "Add your business details (address, phone)", done: !!(d.profile && (d.profile.phone || d.profile.city || d.profile.address_line1)), href: "/flow/app/setup" },
    { id: "hours", label: "Set your opening hours", done: d.hours.length > 0, href: "/flow/app/setup" },
    { id: "services", label: "Add the services callers can book", done: d.services.some((s) => s.active), href: "/flow/app/setup" },
    { id: "agent", label: "Create your receptionist", done: d.agents.length > 0, href: "/flow/app/setup" },
    { id: "team", label: "Invite your team", done: d.members.length > 1, href: "/flow/app/team" },
    { id: "desk", label: "Go available on the staff desk", done: d.team.some((m) => m.status === "available"), href: "/flow/app/desk" },
  ];
  const resolved7Days = d.resolved.filter((c) => c.resolved_at && new Date(c.resolved_at).getTime() >= weekAgo).length;
  return {
    timezone: tz,
    businessName: d.profile?.display_name ?? "",
    agentName: d.agents.find((a) => a.status === "live")?.name ?? d.agents[0]?.name ?? null,
    upcoming,
    today: upcoming.filter((a) => dayIn(a.starts_at, tz) === todayKey),
    next7Days: upcoming.filter((a) => new Date(a.starts_at).getTime() < t + 7 * 86400000).length,
    bookedByAi: upcoming.filter((a) => a.source === "ai_receptionist").length,
    waiting: d.queue,
    inProgress: d.inProgress.length,
    urgent: [...d.queue, ...d.inProgress].filter((c) => c.urgent).length,
    resolved7Days,
    teamAvailable: d.team.filter((m) => m.status === "available").length,
    teamOnDesk: d.team.length,
    setup,
    setupDone: setup.filter((s) => s.done).length,
    isNew: booked.length === 0 && d.queue.length + d.inProgress.length + d.resolved.length === 0,
    usage: d.usage,
    voiceSessions: d.voiceSessions,
  };
}

/** Fetches everything the dashboards need for one workspace. Sections the role can't read come back empty. */
export function useWorkspaceDashboard(orgId: string | null) {
  const [data, setData] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!orgId) return;
    const b = `/orgs/${orgId}`;
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date(Date.now() + 31 * 86400000).toISOString();
    const month = new Date().toISOString().slice(0, 7);
    const get = <T,>(p: string, fallback: T) => api<T>(p).catch(() => fallback);
    try {
      const profile = await api<BusinessProfile>(`${b}/business-profile`); // the one call that must work
      const [settings, hours, services, agents, members, appointments, queue, inProgress, resolved, team, usage, voiceSessions] = await Promise.all([
        get<WorkspaceSettings | null>(`${b}/settings`, null),
        get<{ intervals: HoursInterval[] }>(`${b}/office-hours`, { intervals: [] }),
        get<Service[]>(`${b}/services`, []),
        get<Agent[]>(`${b}/agents`, []),
        get<Member[]>(`${b}/members`, []),
        get<Appointment[]>(`${b}/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, []),
        get<DeskCase[]>(`${b}/cases?status=new`, []),
        get<DeskCase[]>(`${b}/cases?status=in_progress`, []),
        get<DeskCase[]>(`${b}/cases?status=resolved&limit=100`, []),
        get<DeskMember[]>(`${b}/desk/team`, []),
        get<UsageSummary | null>(`${b}/usage/summary?month=${month}`, null),
        get<VoiceTestSession[]>(`${b}/voice-sessions?limit=5`, []),
      ]);
      setData(summarise({ profile, settings, hours: hours.intervals, services, agents, members, appointments, queue, inProgress, resolved, team, usage, voiceSessions }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your workspace");
    }
  }, [orgId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  return { data, error, reload: load };
}

/** "Fri 14 Nov, 14:30" in the workspace's time zone. */
export const fmtIn = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(new Date(iso));

/** Morning / afternoon / evening in the workspace's time zone. */
export function partOfDay(tz: string, now = new Date()): "morning" | "afternoon" | "evening" {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
