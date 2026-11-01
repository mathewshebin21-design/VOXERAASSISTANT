import { describe, expect, it } from "vitest";
import type { Appointment, DeskCase, DeskMember } from "./api";
import { summarise, type DashboardInput } from "./dashboard";

const NOW = new Date("2026-11-03T10:00:00Z"); // Tuesday 10:00 London (GMT)
const appt = (id: string, start: string, o: Partial<Appointment> = {}): Appointment => ({
  id, service_id: "s", service_name: "Cut", starts_at: start, ends_at: new Date(new Date(start).getTime() + 3600000).toISOString(),
  customer_name: "C", customer_phone: "0", notes: null, status: "booked", source: "staff", created_at: start, ...o,
});
const kase = (o: Partial<DeskCase>): DeskCase => ({
  id: Math.random().toString(), kind: "message", caller_name: null, caller_phone: null, summary: "s", reason: null, urgent: false,
  status: "new", source: "ai_receptionist", assigned_to: null, assignee_name: null, assigned_at: null, resolution: null,
  resolved_at: null, resolved_by: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...o,
});
const empty: DashboardInput = { profile: null, settings: null, hours: [], services: [], agents: [], members: [], appointments: [], queue: [], inProgress: [], resolved: [], team: [], usage: null, voiceSessions: [] };

describe("summarise (real workspace dashboard)", () => {
  it("treats a brand-new workspace as new, with every setup step to do", () => {
    const s = summarise(empty, NOW);
    expect(s.isNew).toBe(true);
    expect(s.setupDone).toBe(0);
    expect(s.setup.map((x) => x.id)).toEqual(["profile", "hours", "services", "agent", "team", "desk"]);
    expect(s.upcoming).toEqual([]);
  });

  it("counts today, the next 7 days and AI bookings in the workspace time zone", () => {
    const s = summarise({
      ...empty,
      settings: { timezone: "Europe/London" } as DashboardInput["settings"],
      appointments: [
        appt("past", "2026-11-03T07:00:00Z"), // already finished
        appt("today", "2026-11-03T15:00:00Z", { source: "ai_receptionist" }),
        appt("late-today", "2026-11-03T23:30:00Z"), // still today in London
        appt("in-6-days", "2026-11-09T09:00:00Z"),
        appt("in-10-days", "2026-11-13T09:00:00Z", { source: "ai_receptionist" }),
        appt("cancelled", "2026-11-04T09:00:00Z", { status: "cancelled" }),
      ],
    }, NOW);
    expect(s.upcoming.map((a) => a.id)).toEqual(["today", "late-today", "in-6-days", "in-10-days"]);
    expect(s.today.map((a) => a.id)).toEqual(["today", "late-today"]);
    expect(s.next7Days).toBe(3);
    expect(s.bookedByAi).toBe(2);
    expect(s.isNew).toBe(false);
  });

  it("summarises the desk: waiting, urgent, resolved this week and who is available", () => {
    const team = [{ status: "available" }, { status: "busy" }, { status: "offline" }] as DeskMember[];
    const s = summarise({
      ...empty,
      queue: [kase({ urgent: true }), kase({})],
      inProgress: [kase({ status: "in_progress", urgent: true })],
      resolved: [kase({ status: "resolved", resolved_at: "2026-11-01T10:00:00Z" }), kase({ status: "resolved", resolved_at: "2026-10-01T10:00:00Z" })],
      team, members: [{}, {}] as DashboardInput["members"],
    }, NOW);
    expect([s.waiting.length, s.inProgress, s.urgent, s.resolved7Days]).toEqual([2, 1, 2, 1]);
    expect([s.teamAvailable, s.teamOnDesk]).toEqual([1, 3]);
    expect(s.setup.find((x) => x.id === "team")?.done).toBe(true);
    expect(s.setup.find((x) => x.id === "desk")?.done).toBe(true);
  });
});
