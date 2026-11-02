import { describe, expect, it } from "vitest";
import { describePlan, interpret, reverseLine, savedFrom, type Change, type Saved } from "./commands";
import { advance, reply, type GuidedState } from "./guided";
import { BARBERSHOP } from "./templates";

const saved: Saved = {
  businessName: "Kings Barbers", week: BARBERSHOP.week, services: BARBERSHOP.services.map((s) => ({ ...s, requires_patch_test: false })),
  phone: "0117 496 0123", address_line1: "45 Market St", city: "Manchester", postcode: "M1 1AA", description: "We're a barbershop.",
  capacity: 2, receptionist: { name: "Ava", greeting: "Hello, you're through to Kings Barbers. I'm Ava, the AI receptionist — how can I help?" },
};
const done = (text: string, s: Saved = saved) => {
  const r = interpret(text, s, "barbershop");
  if (!r || !("plan" in r)) throw new Error(`expected a change for “${text}”, got ${JSON.stringify(r)}`);
  return r.plan;
};
const asks = (text: string, s: Saved = saved) => {
  const r = interpret(text, s, "barbershop");
  if (!r || !("ask" in r)) throw new Error(`expected a question for “${text}”, got ${JSON.stringify(r)}`);
  return r.ask;
};
const svc = (c: Change[], name: string) => c.find((x): x is Extract<Change, { kind: "service_update" }> => x.kind === "service_update" && x.name === name)?.patch;

describe("changing services by asking", () => {
  it.each([
    ["skin fade is now £25", "Skin fade", { price_from_pence: 2500 }],
    ["can you change the price of the hot towel shave to £24 please", "Hot towel cut-throat shave", { price_from_pence: 2400 }],
    ["make kids cut 20 minutes", "Kids' cut (under 12)", { duration_min: 20 }],
    ["rename line-up / edge-up to Shape up", "Line-up / edge-up", { name: "Shape up" }],
  ])("%s", (text, name, patch) => expect(svc(done(text).changes, name)).toEqual(patch));

  it("removes, adds and asks about ambiguous names", () => {
    expect(done("we don't do perms anymore").changes).toEqual([{ kind: "service_remove", names: ["Perm or texturising"] }]);
    expect(done("remove head shave and beard colour").done).toEqual(["Removed Head shave and Beard colour"]);
    expect(done("add beard dye 20 min £15").changes[0]).toMatchObject({ kind: "service_add", services: [{ name: "Beard dye", duration_min: 20, price_from_pence: 1500 }] });
    expect(done("we now offer eyebrow threading £7").notes.join(" ")).toMatch(/no length given, so I used 30 minutes/);
    expect(asks("fade £26")).toMatch(/could be Skin fade, Low, mid or high fade, Taper fade and Fade and hot towel beard sculpt/);
    expect(asks("remove the hair tattoo")).toMatch(/I can't find “hair tattoo”/);
    expect(asks("skin fade £24")).toMatch(/already 45 min, £24/);
  });

  it("changes every price at once, or one category", () => {
    const all = done("put all prices up by £2");
    expect(all.changes).toHaveLength(29);
    expect(svc(all.changes, "Classic men's cut")).toEqual({ price_from_pence: 2200 });
    const cuts = done("increase all haircuts by 10%");
    expect(cuts.changes).toHaveLength(11);
    expect(svc(cuts.changes, "Skin fade")).toEqual({ price_from_pence: 2640 });
  });
});

describe("changing hours by asking", () => {
  const day = (text: string, d: number, s?: Saved) => (done(text, s).changes[0] as Extract<Change, { kind: "hours" }>).week[d];
  it.each([
    ["we're closed on Mondays now", 0, []],
    ["change Saturday to 9-5", 5, [{ opens: "09:00", closes: "17:00" }]],
    ["we're open till 9 on Thursdays", 3, [{ opens: "09:00", closes: "21:00" }]],
    ["we don't open on sundays anymore", 6, []],
    ["Friday 9-12 and 1-7", 4, [{ opens: "09:00", closes: "12:00" }, { opens: "13:00", closes: "19:00" }]],
    ["we close at 6 on wednesdays", 2, [{ opens: "09:00", closes: "18:00" }]],
    ["we open at 10 on saturdays", 5, [{ opens: "10:00", closes: "17:00" }]],
  ])("%s", (text, d, periods) => expect(day(text as string, d as number)).toEqual(periods));

  it("keeps the other days as they were, and says what changed", () => {
    const p = done("change Saturday to 9-5");
    expect(p.done).toEqual(["Saturday: 08:30–17:00 → 09:00–17:00"]);
    expect((p.changes[0] as Extract<Change, { kind: "hours" }>).week[0]).toEqual(BARBERSHOP.week[0]);
  });

  it("“every day” means every day you're open", () => {
    const monClosed = { ...saved, week: saved.week.map((d, i) => (i === 0 ? [] : d)) };
    expect(day("close at 6 every day", 0, monClosed)).toEqual([]);
    expect(day("close at 6 every day", 1, monClosed)).toEqual([{ opens: "09:00", closes: "18:00" }]);
  });

  it("asks rather than guessing", () => {
    expect(asks("we close at 5 now")).toMatch(/Which days/);
    expect(asks("we're open till 9 on mondays", { ...saved, week: saved.week.map((d, i) => (i === 0 ? [] : d)) })).toMatch(/closed on Mondays at the moment/);
  });
});

describe("changing other details by asking", () => {
  it("phone, address, capacity", () => {
    expect(done("our new number is 07700 900123").changes).toEqual([{ kind: "profile", patch: { phone: "07700 900123" } }]);
    expect(done("we've moved to 12 High Street, Leeds, LS1 4DJ").changes).toEqual([{ kind: "profile", patch: { address_line1: "12 High Street", city: "Leeds", postcode: "LS1 4DJ" } }]);
    expect(done("we have 3 barbers now").changes).toEqual([{ kind: "capacity", capacity: 3 }]);
    expect(done("we hired another barber").changes).toEqual([{ kind: "capacity", capacity: 3 }]);
    expect(done("one of the barbers left").changes).toEqual([{ kind: "capacity", capacity: 1 }]);
  });

  it("receptionist name and greeting, keeping the AI disclosure", () => {
    expect(done("rename the receptionist to Sam").changes).toEqual([{ kind: "receptionist", patch: { name: "Sam", greeting: "Hello, you're through to Kings Barbers. I'm Sam, the AI receptionist — how can I help?" } }]);
    const g = done("change the greeting to Hi, thanks for calling Kings Barbers!");
    expect(g.changes).toEqual([{ kind: "receptionist", patch: { greeting: "Hi, thanks for calling Kings Barbers. I'm Ava, the AI receptionist." } }]);
    expect(g.notes[0]).toMatch(/UK rules/);
  });

  it("adds what callers should be told to the description", () => {
    expect(done("tell callers we have free parking behind the shop").changes).toEqual([{ kind: "profile", patch: { description: "We're a barbershop.\nWe have free parking behind the shop." } }]);
    expect(done("we're closed on bank holidays").done[0]).toMatch(/We're closed on bank holidays/);
  });

  it("ignores things that aren't change requests", () => {
    for (const t of ["thanks", "what's the weather", "yes", "hello"]) expect(interpret(t, saved, "barbershop")).toBeNull();
  });
});

describe("undo", () => {
  it("each change comes with its exact reverse", () => {
    for (const text of ["skin fade is now £25", "remove head shave", "add beard dye 20 min £15", "we're closed on Mondays now", "our new number is 07700 900123", "rename the receptionist to Sam", "put all prices up by £2"]) {
      const p = done(text);
      expect(p.undo.length).toBeGreaterThan(0);
    }
    expect(done("remove head shave").undo).toEqual([{ kind: "service_add", services: [saved.services.find((s) => s.name === "Head shave")] }]);
    expect(done("we're closed on Mondays now").undo).toEqual([{ kind: "hours", week: saved.week }]);
  });
  it.each([
    ["Skin fade: £24 → £25", "Skin fade: £25 → £24"],
    ["Added Beard dye — 20 min, from £15", "Removed Beard dye"],
    ["Removed Head shave", "Put back Head shave"],
    ["Renamed Line-up → Shape up", "Renamed Shape up → Line-up"],
    ["  Skin fade: £24 → £26", "  Skin fade: £26 → £24"],
  ])("%s", (a, b) => expect(reverseLine(a)).toBe(b));
  it("summaries tell the owner how to undo", () => {
    expect(describePlan(done("skin fade is now £25"))).toEqual(["Done — Skin fade: £24 → £25", "Say “undo” to put it back."]);
  });
});

describe("in the setup chat", () => {
  const at = (step: GuidedState["step"], extra: Partial<GuidedState> = {}): GuidedState => ({ step, businessName: "Kings Barbers", sector: "barbershop", pending: null, saved, ...extra });

  it("makes changes straight away after setup, and undoes them", () => {
    const t = reply(at("done"), "skin fade is now £25");
    expect(t.action).toEqual({ type: "changes", changes: [{ kind: "service_update", name: "Skin fade", patch: { price_from_pence: 2500 } }] });
    expect(t.stay).toBe(true);
    const u = reply(t.state, "undo");
    expect(u.action).toEqual({ type: "changes", changes: [{ kind: "service_update", name: "Skin fade", patch: { duration_min: 45, price_from_pence: 2400 } }] });
    expect(u.say[0]).toBe("Put back: Skin fade: £25 → £24");
    expect(reply(u.state, "undo").action).toBeUndefined();
  });

  it("handles a change about something else mid-setup, then asks the same question again", () => {
    const t = reply(at("capacity", { saved: { ...saved, capacity: 1 } }), "actually our number is 07700 900123");
    expect(t.action).toEqual({ type: "changes", changes: [{ kind: "profile", patch: { phone: "07700 900123" } }] });
    expect(t.say[t.say.length - 1]).toMatch(/How many customers/);
  });

  it("edits saved hours instead of starting a new week", () => {
    const t = reply(at("hours"), "Saturday 9-5");
    expect(t.action?.type).toBe("changes");
    expect(t.stay).toBeFalsy(); // that answers the hours question, so setup moves on
    expect(advance(t.state).state.step).toBe("services");
  });

  it("keeps a list that is waiting for a yes", () => {
    const shown = reply(at("services", { saved: { ...saved, services: [] } }), "template");
    const t = reply(shown.state, "we close at 6 on wednesdays");
    expect(t.action?.type).toBe("changes");
    expect(t.state.pending).toEqual(shown.state.pending);
    expect(t.say[t.say.length - 1]).toMatch(/back to the list above/);
    expect(reply(t.state, "remove head shave").action).toBeUndefined(); // edits the list, not saved services
  });

  it("lets the current question's answer win", () => {
    expect(reply(at("type"), "we're a barbers with 3 chairs").action).toEqual({ type: "profile", patch: { sector: "barbershop" } });
    expect(reply(at("capacity", { saved: { ...saved, capacity: 1 } }), "3").action).toEqual({ type: "capacity", capacity: 3 });
    expect(reply(at("hours", { saved: { ...saved, week: [[], [], [], [], [], [], []] } }), "Mon-Fri 9-5").state.pending?.kind).toBe("hours");
  });

  it("says how to ask for a change when it doesn't catch one", () => {
    expect(reply(at("done"), "hello").say[0]).toMatch(/Just tell me what you'd like/);
  });
});

describe("reading the workspace", () => {
  it("turns API data into saved hours and services", () => {
    const s = savedFrom({
      profile: { display_name: "K", sector: "barbershop", phone: null, email: null, website: null, address_line1: null, address_line2: null, city: null, postcode: null, country: "GB", description: null },
      hours: [{ weekday: 0, opens_at: "14:00:00", closes_at: "17:00:00" }, { weekday: 0, opens_at: "09:00:00", closes_at: "13:00:00" }],
      services: [{ id: "1", name: "Cut", category: null, duration_min: 30, buffer_min: 0, price_from_pence: 2000, bookable_by_agent: true, requires_patch_test: false, active: true },
        { id: "2", name: "Old", category: null, duration_min: 30, buffer_min: 0, price_from_pence: null, bookable_by_agent: true, requires_patch_test: false, active: false }],
      agents: [], settings: null,
    });
    expect(s.week[0]).toEqual([{ opens: "09:00", closes: "13:00" }, { opens: "14:00", closes: "17:00" }]);
    expect(s.services.map((x) => x.name)).toEqual(["Cut"]);
    expect(s.capacity).toBe(1);
    expect(s.receptionist).toBeNull();
  });
});
