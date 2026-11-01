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
