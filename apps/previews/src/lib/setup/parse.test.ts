import { describe, expect, it } from "vitest";
import { describeWeek, isSkip, isYes, parseAddress, parseDays, parseHours, parsePhone, parseRange, parseSector, parseServices } from "./parse";

describe("parseDays", () => {
  it.each([
    ["Mon-Fri", [0, 1, 2, 3, 4]], ["Monday to Friday", [0, 1, 2, 3, 4]], ["Tue–Sat", [1, 2, 3, 4, 5]],
    ["sat & sun", [5, 6]], ["weekdays", [0, 1, 2, 3, 4]], ["weekends", [5, 6]], ["every day", [0, 1, 2, 3, 4, 5, 6]],
    ["Fri-Mon", [0, 4, 5, 6]], ["thursdays", [3]],
  ])("%s", (t, days) => expect(parseDays(t as string)).toEqual(days));
});

describe("parseRange", () => {
  it.each([
    ["9-5", "09:00", "17:00"], ["9am-5:30pm", "09:00", "17:30"], ["10 till 2", "10:00", "14:00"], ["8-8", "08:00", "20:00"],
    ["8:30am to 6pm", "08:30", "18:00"], ["1-5pm", "13:00", "17:00"], ["10:00-16:00", "10:00", "16:00"], ["9 to noon", "09:00", "12:00"],
  ])("%s", (t, o, c) => expect(parseRange(t as string)).toMatchObject({ opens: o, closes: c }));
  it("rejects nonsense", () => { expect(parseRange("open whenever")).toBeNull(); expect(parseRange("5pm-9am")).toBeNull(); });
});

describe("parseHours", () => {
  it("reads a typical salon week, with overrides and closed days", () => {
    const r = parseHours("Tue–Sat 9–5:30, Thu late till 8pm, Sun and Mon closed");
    expect(describeWeek(r.week)).toEqual([
      "Monday: closed", "Tuesday: 09:00–17:30", "Wednesday: 09:00–17:30", "Thursday: 09:00–20:00", "Friday: 09:00–17:30", "Saturday: 09:00–17:30", "Sunday: closed",
    ]);
    expect(r.understood).toBe(true);
    expect(r.unparsed).toEqual([]);
  });
  it("handles weekdays/weekends and records assumptions", () => {
    const r = parseHours("weekdays 9-6\nweekends 10-4");
    expect(r.week[0]).toEqual({ opens: "09:00", closes: "18:00" });
    expect(r.week[6]).toEqual({ opens: "10:00", closes: "16:00" });
    expect(r.assumptions.length).toBe(2);
  });
  it("reports what it couldn't read instead of guessing", () => {
    const r = parseHours("Mon-Fri 9-5; by appointment at other times");
    expect(r.unparsed).toEqual(["by appointment at other times"]);
    expect(r.week[5]).toBeNull();
  });
});

describe("parseServices", () => {
  it("reads common formats", () => {
    const { services, unparsed } = parseServices("Women's cut - 60 min - £45\nBalayage, 3 hours, from £120\nGents cut 30mins £20\nColour 1h30 £75 (needs patch test)\nConsultation 15 minutes free");
    expect(unparsed).toEqual([]);
    expect(services.map((s) => [s.name, s.duration_min, s.price_from_pence, s.requires_patch_test])).toEqual([
      ["Women's cut", 60, 4500, false],
      ["Balayage", 180, 12000, false],
      ["Gents cut", 30, 2000, false],
      ["Colour", 90, 7500, true],
      ["Consultation free", 15, null, false],
    ]);
  });
  it("keeps services with a missing duration for the caller to fill in", () => {
    expect(parseServices("Blow dry £30").services[0]).toMatchObject({ name: "Blow dry", duration_min: null, price_from_pence: 3000 });
  });
});

describe("contact details and business type", () => {
  it("finds UK phone numbers", () => {
    expect(parsePhone("call us on 0117 496 0123 please")).toBe("0117 496 0123");
    expect(parsePhone("+44 7700 900123")).toBe("+44 7700 900123");
    expect(parsePhone("no number")).toBeNull();
  });
  it("splits an address", () => {
    expect(parseAddress("12 High Street, Bristol, bs1 4dj")).toEqual({ address_line1: "12 High Street", city: "Bristol", postcode: "BS1 4DJ" });
    expect(parseAddress("Leeds")).toEqual({ address_line1: null, city: "Leeds", postcode: null });
  });
  it.each([["We're a barbers in town", "barbershop"], ["Barber shop", "barbershop"], ["EW SALOON", "hair_beauty"], ["sports physio clinic", "clinic"], ["emergency plumbing", "trades"], ["Italian restaurant", "hospitality"], ["yoga studio", "fitness"], ["solicitors", "professional"], ["a shop", null]])(
    "%s → %s", (t, s) => expect(parseSector(t as string)).toBe(s));
  it("yes / skip", () => {
    expect(isYes("yes that's right")).toBe(true);
    expect(isYes("yes but change Saturday")).toBe(false);
    expect(isSkip("skip for now")).toBe(true);
  });
});
