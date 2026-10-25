// Availability + booking rules used by the conversation simulator and calendars.
// This is a client-side model of the Phase 7 engine: it enforces working hours,
// service durations, buffers and conflicts. The production version will run the
// same checks inside a database transaction (with an exclusion constraint) so
// two concurrent callers cannot take the same slot.

import { SERVICES, STAFF, serviceById } from "./demo-data";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, diffDays, dow } from "./time";
import type { Appointment } from "./types";

export interface Slot {
  date: string;
  startMin: number;
  staffId: string;
}

export interface SlotQuery {
  serviceId: string;
  fromDate: string;
  days?: number;
  staffId?: string;
  afterMin?: number;
  beforeMin?: number;
  limit?: number;
}

const STEP = 15;

function busy(appts: Appointment[], staffId: string, date: string) {
  return appts
    .filter((a) => a.staffId === staffId && a.date === date && a.status !== "cancelled")
    .map((a) => [a.startMin, a.startMin + a.durationMin + serviceById(a.serviceId).bufferMin] as const);
}

export function isFree(appts: Appointment[], staffId: string, date: string, start: number, serviceId: string, ignoreId?: string): boolean {
  const svc = serviceById(serviceId);
  const st = STAFF.find((s) => s.id === staffId);
  const h = st?.hours[dow(date)];
  if (!st || !h || !st.serviceIds.includes(serviceId)) return false;
  const end = start + svc.durationMin;
  if (start < h[0] || end > h[1]) return false;
  if (date < DEMO_TODAY || (date === DEMO_TODAY && start <= DEMO_NOW_MIN + 30)) return false;
  const others = appts.filter((a) => a.id !== ignoreId);
  return busy(others, staffId, date).every(([s, e]) => end + svc.bufferMin <= s || start >= e);
}

export function findSlots(appts: Appointment[], q: SlotQuery): Slot[] {
  const out: Slot[] = [];
  const svc = serviceById(q.serviceId);
  const staff = STAFF.filter((s) => s.serviceIds.includes(svc.id) && (!q.staffId || s.id === q.staffId));
  for (let i = 0; i < (q.days ?? 7); i++) {
    const date = addDays(q.fromDate, i);
    for (let t = 8 * 60; t <= 20 * 60; t += STEP) {
      if (q.afterMin != null && t < q.afterMin) continue;
      if (q.beforeMin != null && t + svc.durationMin > q.beforeMin) continue;
      for (const st of staff) {
        if (isFree(appts, st.id, date, t, svc.id)) {
          out.push({ date, startMin: t, staffId: st.id });
          break; // one stylist per time is enough to offer
        }
      }
      if (out.length >= (q.limit ?? 50)) return out;
    }
  }
  return out;
}

/** Spread offers so the caller hears a meaningful choice rather than 09:00, 09:15, 09:30. */
export function spreadSlots(slots: Slot[], n = 3, minGap = 90): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    if (out.every((o) => o.date !== s.date || Math.abs(o.startMin - s.startMin) >= minGap)) out.push(s);
    if (out.length === n) break;
  }
  return out;
}

export type BookingResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: "conflict" | "not_bookable" | "patch_test_required" | "unconfirmed" };

export interface BookingRequest {
  serviceId: string;
  staffId: string;
  date: string;
  startMin: number;
  customerName: string;
  confirmedByCaller: boolean;
  idempotencyKey: string;
  patchTestOnFile?: boolean;
}

/**
 * Validates and creates a booking. Idempotent: replaying the same key returns
 * the original appointment instead of creating a duplicate.
 */
export function createBooking(appts: Appointment[], req: BookingRequest): BookingResult {
  const existing = appts.find((a) => a.id === `apt-${req.idempotencyKey}`);
  if (existing) return { ok: true, appointment: existing };
  if (!req.confirmedByCaller) return { ok: false, reason: "unconfirmed" };
  const svc = SERVICES.find((s) => s.id === req.serviceId);
  if (!svc || !svc.bookableByAgent) return { ok: false, reason: "not_bookable" };
  if (svc.requiresPatchTest && !req.patchTestOnFile && diffDays(req.date, DEMO_TODAY) < 2) return { ok: false, reason: "patch_test_required" };
  if (!isFree(appts, req.staffId, req.date, req.startMin, req.serviceId)) return { ok: false, reason: "conflict" };
  return {
    ok: true,
    appointment: {
      id: `apt-${req.idempotencyKey}`,
      serviceId: req.serviceId, staffId: req.staffId, date: req.date, startMin: req.startMin,
      durationMin: svc.durationMin, customerName: req.customerName, status: "confirmed", bookedVia: "voice_agent",
    },
  };
}
