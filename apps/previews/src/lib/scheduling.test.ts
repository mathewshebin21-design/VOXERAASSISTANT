import { describe, expect, it } from "vitest";
import { createBooking, findSlots, isFree } from "./scheduling";
import { APPOINTMENTS } from "./demo-data";
import { DEMO_TODAY, addDays, dow } from "./time";

const nextDow = (d: number) => { for (let i = 1; i <= 7; i++) { const k = addDays(DEMO_TODAY, i); if (dow(k) === d) return k; } throw 0; };

describe("availability", () => {
  it("never offers a slot that overlaps an existing appointment", () => {
    const slots = findSlots(APPOINTMENTS, { serviceId: "svc-cut-w", fromDate: addDays(DEMO_TODAY, 1), days: 7, limit: 500 });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const clash = APPOINTMENTS.some((a) => a.staffId === s.staffId && a.date === s.date && a.status !== "cancelled" && s.startMin < a.startMin + a.durationMin && s.startMin + 60 > a.startMin);
      expect(clash).toBe(false);
    }
  });

  it("offers nothing on days the studio is closed", () => {
    const monday = nextDow(1);
    expect(findSlots(APPOINTMENTS, { serviceId: "svc-cut-w", fromDate: monday, days: 1 })).toHaveLength(0);
  });

  it("respects staff who don't perform a service", () => {
    expect(isFree([], "stf-ben", nextDow(5), 600, "svc-balay")).toBe(false);
  });
});

describe("createBooking", () => {
  const thu = nextDow(4);
  const req = { serviceId: "svc-cut-w", staffId: "stf-ada", date: thu, startMin: 18 * 60 + 15, customerName: "Test Caller", confirmedByCaller: true, idempotencyKey: "k1" };

  it("refuses to book without explicit caller confirmation", () => {
    expect(createBooking([], { ...req, confirmedByCaller: false })).toEqual({ ok: false, reason: "unconfirmed" });
  });

  it("prevents double booking the same stylist and time", () => {
    const first = createBooking([], req);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = createBooking([first.appointment], { ...req, idempotencyKey: "k2", customerName: "Someone Else" });
    expect(second).toEqual({ ok: false, reason: "conflict" });
  });

  it("is idempotent when the same request is replayed", () => {
    const first = createBooking([], req);
    if (!first.ok) throw new Error("expected booking");
    const replay = createBooking([first.appointment], req);
    expect(replay.ok && replay.appointment.id).toBe(first.appointment.id);
  });

  it("rejects services staff must arrange", () => {
    expect(createBooking([], { ...req, serviceId: "svc-bridal" })).toEqual({ ok: false, reason: "not_bookable" });
  });

  it("enforces the 48h patch-test rule for colour", () => {
    const tomorrow = addDays(DEMO_TODAY, 1);
    expect(createBooking([], { ...req, serviceId: "svc-tint", staffId: "stf-isla", date: tomorrow, startMin: 600 })).toEqual({ ok: false, reason: "patch_test_required" });
  });
});
