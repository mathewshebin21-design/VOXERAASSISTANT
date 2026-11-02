import { describe, expect, it } from "vitest";
import { advance, prompt, reply, type GuidedState } from "./guided";

const start: GuidedState = { step: "type", businessName: "EW Saloon", pending: null };

describe("guided setup assistant", () => {
  it("walks through the steps, saving each answer", () => {
    let t = reply(start, "we're a hair salon");
    expect(t.action).toEqual({ type: "profile", patch: { sector: "hair_beauty" } });
    t = advance(t.state);
    expect(t.state.step).toBe("phone");
    t = reply(t.state, "0117 496 0123");
    expect(t.action).toEqual({ type: "profile", patch: { phone: "0117 496 0123" } });
    t = advance(t.state);
    t = reply(t.state, "12 High Street, Bristol, BS1 4DJ");
    expect(t.action).toMatchObject({ type: "profile", patch: { city: "Bristol", postcode: "BS1 4DJ" } });
  });

  it("shows hours back and only saves after a yes", () => {
    const s: GuidedState = { ...start, step: "hours" };
    let t = reply(s, "Tue-Sat 9-5:30, Sun and Mon closed");
    expect(t.action).toBeUndefined();
    expect(t.say.join("\n")).toContain("Tuesday: 09:00–17:30");
    expect(t.state.pending?.kind).toBe("hours");
    t = reply(t.state, "yes");
    expect(t.action?.type).toBe("hours");
  });

  it("treats a non-yes as a corrected answer", () => {
    let t = reply({ ...start, step: "hours" }, "Mon-Fri 9-5");
    t = reply(t.state, "Mon-Sat 9-6");
    expect(t.action).toBeUndefined();
    expect(t.say.join("\n")).toContain("Saturday: 09:00–18:00");
  });

  it("flags assumed service lengths before saving", () => {
    let t = reply({ ...start, step: "services" }, "Women's cut 60 min £45\nBlow dry £30");
    expect(t.say.join("\n")).toMatch(/Blow dry — 30 min \(assumed\)/);
    t = reply(t.state, "yes please");
    expect(t.action).toMatchObject({ type: "services" });
    expect(t.action && t.action.type === "services" && t.action.services.map((s) => s.duration_min)).toEqual([60, 30]);
  });

  it("asks again when it doesn't understand, and supports skipping", () => {
    expect(reply(start, "a shop").action).toBeUndefined();
    const t = reply({ ...start, step: "phone" }, "skip");
    expect(t.state.step).toBe("address");
    expect(t.say[1]).toBe(prompt("address", "EW Saloon"));
  });

  it("creates a receptionist whose greeting discloses it is an AI", () => {
    const t = reply({ ...start, step: "receptionist" }, "call her ava");
    expect(t.action).toEqual({ type: "agent", name: "Ava", greeting: "Hello, you're through to EW Saloon. I'm Ava, the AI receptionist — how can I help?" });
    expect(advance(t.state).state.step).toBe("done");
  });

  it("skips steps that are already done", () => {
    const t = advance({ ...start, step: "type" }, new Set(["phone", "address", "hours"]));
    expect(t.state.step).toBe("services");
  });
});

describe("barbershop template", () => {
  const barber: GuidedState = { step: "type", businessName: "Kings Barbers", pending: null };

  it("recognises a barbers and offers the template", () => {
    const t = reply(barber, "we're a barber shop");
    expect(t.action).toEqual({ type: "profile", patch: { sector: "barbershop" } });
    expect(t.state.sector).toBe("barbershop");
    expect(t.say.join("\n")).toMatch(/template/);
    const hours = advance(t.state, new Set(["phone", "address"]));
    expect(hours.state.step).toBe("hours");
    expect(hours.say[0]).toMatch(/say “template”/);
  });

  it("loads template hours and only saves after a yes", () => {
    let t = reply({ ...barber, step: "hours", sector: "barbershop" }, "use the template");
    expect(t.action).toBeUndefined();
    expect(t.say.join("\n")).toContain("Thursday: 09:00–20:00");
    t = reply(t.state, "yes");
    expect(t.action?.type === "hours" && t.action.week[3]).toEqual({ opens: "09:00", closes: "20:00" });
  });

  it("loads the menu with categories, buffers and policies", () => {
    let t = reply({ ...barber, step: "services", sector: "barbershop" }, "template");
    const text = t.say.join("\n");
    expect(text).toContain("Skin fade — 45 min, from £24");
    expect(text).toContain("Beard & shaving:");
    t = reply(t.state, "yes");
    expect(t.action?.type).toBe("services");
    if (t.action?.type !== "services") return;
    expect(t.action.services.length).toBeGreaterThan(20);
    expect(t.action.services[0]).toMatchObject({ name: "Classic men's cut", category: "Haircuts", duration_min: 30, buffer_min: 5, price_from_pence: 2000 });
    expect(t.action.description).toMatch(/24 hours' notice/);
  });

  it("doesn't offer a template to businesses without one", () => {
    expect(prompt("services", "EW Saloon", "hair_beauty")).not.toMatch(/template/);
    const t = reply({ ...start, step: "services", sector: "hair_beauty" }, "template");
    expect(t.state.pending).toBeNull();
    expect(t.say[0]).toMatch(/don't have a ready-made template/);
  });
});
