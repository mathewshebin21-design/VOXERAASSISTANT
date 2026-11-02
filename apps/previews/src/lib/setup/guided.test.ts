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
    expect(t.action?.type === "hours" && t.action.week[3]).toEqual([{ opens: "09:00", closes: "20:00" }]);
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

// Conversations the way owners really type them. A pending list or week must never be lost
// to a misunderstanding: edits change it in place and anything unclear is asked about.
describe("understanding owners without confusion", () => {
  const b: GuidedState = { step: "hours", businessName: "Kings Barbers", sector: "barbershop", pending: null };
  const say = (t: { say: string[] }) => t.say.join("\n");
  const pendingServices = (t: { state: GuidedState }) => (t.state.pending?.kind === "services" ? t.state.pending.services : []);
  const pendingWeek = (t: { state: GuidedState }) => (t.state.pending?.kind === "hours" ? t.state.pending.week : []);
  const menu = () => reply({ ...b, step: "services" }, "template");

  it("merges “yes but …” corrections into the hours already shown", () => {
    const t = reply(reply(b, "template").state, "yes but thursday till 9 and sunday closed");
    expect(t.action).toBeUndefined();
    expect(pendingWeek(t)[3]).toEqual([{ opens: "09:00", closes: "21:00" }]);
    expect(pendingWeek(t)[6]).toEqual([]);
    expect(pendingWeek(t)[0]).toEqual([{ opens: "09:00", closes: "19:00" }]);
  });

  it("changes one day without wiping the others", () => {
    const t = reply(reply(b, "Mon-Sat 9-6").state, "Saturday 9-5");
    expect(say(t)).toContain("Changed: Saturday 09:00–17:00");
    expect(pendingWeek(t)[0]).toEqual([{ opens: "09:00", closes: "18:00" }]);
  });

  it("takes the template and a change in one message", () => {
    expect(pendingWeek(reply(b, "use the template but sunday closed"))[6]).toEqual([]);
    const t = reply({ ...b, step: "services" }, "template but remove head shave");
    expect(pendingServices(t).some((s) => s.name === "Head shave")).toBe(false);
  });

  it("warns when unmentioned days will be closed", () => {
    expect(say(reply(b, "Mon-Fri 9-5"))).toMatch(/You didn't mention Saturday, Sunday, so I've marked them closed/);
  });

  it("removes services even when their names contain “and” or “or”", () => {
    const t = reply(menu().state, "remove head shave and perm or texturising");
    expect(say(t)).toContain("removed Head shave, removed Perm or texturising");
    expect(pendingServices(t)).toHaveLength(27);
  });

  it("asks which one when a name is ambiguous, keeping the list", () => {
    const t = reply(menu().state, "fade £25");
    expect(say(t)).toMatch(/“Fade” matches Skin fade, .*which one/);
    expect(pendingServices(t)).toHaveLength(29);
  });

  it("updates prices and times by name", () => {
    let t = reply(menu().state, "skin fade £25");
    expect(pendingServices(t).find((s) => s.name === "Skin fade")?.price_from_pence).toBe(2500);
    t = reply(t.state, "change kids cut to 20 min");
    expect(pendingServices(t).find((s) => s.name.startsWith("Kids"))?.duration_min).toBe(20);
    t = reply(t.state, "yes but hot towel shave is £25");
    expect(pendingServices(t).find((s) => s.name === "Hot towel cut-throat shave")?.price_from_pence).toBe(2500);
    expect(pendingServices(t).find((s) => s.name.startsWith("The Works"))?.price_from_pence).toBe(5000);
  });

  it("adds new lines to a list instead of replacing it", () => {
    let t = reply(menu().state, "Beard dye 20 min £15");
    expect(pendingServices(t)).toHaveLength(30);
    t = reply(t.state, "add eyebrow threading £7, nose wax 10 min £6");
    expect(pendingServices(t)).toHaveLength(32);
    t = reply(t.state, "start the list again");
    expect(t.state.pending).toBeNull();
  });

  it("fills missing lengths from the barbershop template", () => {
    const t = reply({ ...b, step: "services" }, "Skin fade £25\nKids cut £15\nPet portrait £50");
    const s = pendingServices(t);
    expect(s.map((x) => x.duration_min)).toEqual([45, 25, 30]);
    expect(say(t)).toMatch(/typical for barbershops/);
    expect(say(t)).toMatch(/Pet portrait — 30 min \(assumed\)/);
  });

  it("answers questions instead of misreading them", () => {
    expect(say(reply({ ...b, step: "capacity" }, "what does that mean?"))).toMatch(/how many appointments can run at the same moment/);
    expect(say(reply({ ...b, step: "receptionist" }, "what should I call it?"))).toMatch(/name the AI uses/);
    expect(reply({ ...b, step: "receptionist" }, "what should I call it?").action).toBeUndefined();
    expect(say(reply({ ...b, step: "hours" }, "why do you need this?"))).toMatch(/only offers appointments inside these hours/);
  });

  it("goes back, jumps to a step, and restarts", () => {
    expect(reply({ ...b, step: "capacity" }, "go back").state.step).toBe("services");
    expect(reply({ ...b, step: "done" }, "change the hours").state.step).toBe("hours");
    expect(reply({ ...b, step: "receptionist" }, "can I edit the services").state.step).toBe("services");
    expect(reply({ ...b, step: "capacity" }, "start again").state.step).toBe("type");
  });

  it("handles a bare “no” without losing what was shown", () => {
    const shown = reply(b, "Mon-Fri 9-5");
    const t = reply(shown.state, "no");
    expect(t.state.pending).toEqual(shown.state.pending);
    expect(say(t)).toMatch(/tell me what to change/);
  });

  it("reads capacity and names the way people say them", () => {
    expect(reply({ ...b, step: "capacity" }, "we have 4 chairs but 2 barbers").action).toEqual({ type: "capacity", capacity: 2 });
    expect(reply({ ...b, step: "capacity" }, "me and two others").action).toEqual({ type: "capacity", capacity: 3 });
    expect(reply({ ...b, step: "receptionist" }, "let's go with ava please").action).toMatchObject({ name: "Ava" });
    expect(reply({ ...b, step: "receptionist" }, "how about Mary-Jane").action).toMatchObject({ name: "Mary-Jane" });
  });

  it("works the same for a business without a template", () => {
    const p: GuidedState = { step: "type", businessName: "Swift Plumbing", pending: null };
    let t = reply(p, "we're an emergency plumber");
    expect(t.action).toEqual({ type: "profile", patch: { sector: "trades" } });
    t = reply({ ...t.state, step: "services" }, "Boiler service 1 hour £80, Callout 45 min £65\nLeak repair from £90-£150 1.5 hours");
    expect(pendingServices(t).map((s) => [s.name, s.duration_min, s.price_from_pence])).toEqual([["Boiler service", 60, 8000], ["Callout", 45, 6500], ["Leak repair", 90, 9000]]);
    t = reply(t.state, "callout £70");
    expect(pendingServices(t).find((s) => s.name === "Callout")?.price_from_pence).toBe(7000);
  });
});
