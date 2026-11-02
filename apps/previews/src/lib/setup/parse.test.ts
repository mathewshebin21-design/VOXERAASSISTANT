import { describe, expect, it } from "vitest";
import { describeWeek, isSkip, isYes, parseAddress, parseCount, parseDays, parseHours, parsePhone, parseRange, parseSector, parseServices, yesBut } from "./parse";

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
    expect(r.week[0]).toEqual([{ opens: "09:00", closes: "18:00" }]);
    expect(r.week[6]).toEqual([{ opens: "10:00", closes: "16:00" }]);
    expect(r.assumptions.length).toBe(2);
  });
  it("reports what it couldn't read instead of guessing", () => {
    const r = parseHours("Mon-Fri 9-5; by appointment at other times");
    expect(r.unparsed).toEqual(["by appointment at other times"]);
    expect(r.week[5]).toEqual([]);
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
      ["Consultation", 15, 0, false],
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

// The ways real owners answer. Each row is [what they typed, Monday … Sunday as describeWeek shows it].
const week = (...days: string[]) => days;
describe("opening hours as owners write them", () => {
  const C = "closed";
  it.each([
    ["9am to 7pm Monday to Saturday, closed Sunday", week("09:00–19:00", "09:00–19:00", "09:00–19:00", "09:00–19:00", "09:00–19:00", "09:00–19:00", C)],
    ["Monday - Friday: 9:00 - 19:00, Saturday: 8:30 - 17:00, Sunday: 10:00 - 16:00", week("09:00–19:00", "09:00–19:00", "09:00–19:00", "09:00–19:00", "09:00–19:00", "08:30–17:00", "10:00–16:00")],
    ["Monday to Friday, 9am-5pm", week("09:00–17:00", "09:00–17:00", "09:00–17:00", "09:00–17:00", "09:00–17:00", C, C)],
    ["9.30-5.30 mon-sat", week("09:30–17:30", "09:30–17:30", "09:30–17:30", "09:30–17:30", "09:30–17:30", "09:30–17:30", C)],
    ["Open every day except Sunday 9-6", week("09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", C)],
    ["9-6 except sundays", week("09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", C)],
    ["mon-fri 9-12 and 1-5", week("09:00–12:00 and 13:00–17:00", "09:00–12:00 and 13:00–17:00", "09:00–12:00 and 13:00–17:00", "09:00–12:00 and 13:00–17:00", "09:00–12:00 and 13:00–17:00", C, C)],
    ["Mon-Fri 9-5 closed 1-2 for lunch", week("09:00–13:00 and 14:00–17:00", "09:00–13:00 and 14:00–17:00", "09:00–13:00 and 14:00–17:00", "09:00–13:00 and 14:00–17:00", "09:00–13:00 and 14:00–17:00", C, C)],
    ["Mon-Sat 9-6, Thursday late night till 9", week("09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–21:00", "09:00–18:00", "09:00–18:00", C)],
    ["Tue-Sat 9-5, Sunday 10-4, Monday off", week(C, "09:00–17:00", "09:00–17:00", "09:00–17:00", "09:00–17:00", "09:00–17:00", "10:00–16:00")],
    ["open 24/7", week(...Array(7).fill("00:00–23:59"))],
  ])("%s", (text, days) => {
    const r = parseHours(text as string);
    expect(r.understood).toBe(true);
    expect(r.unparsed).toEqual([]);
    expect(describeWeek(r.week).map((d) => d.split(": ")[1])).toEqual(days);
  });
  it("notes bank holidays rather than dropping them silently", () => {
    const r = parseHours("weekdays 9 til 6, closed sundays and bank holidays");
    expect(r.assumptions.join(" ")).toMatch(/bank holidays/);
  });
  it("reports which days the answer mentioned", () => {
    expect(parseHours("Saturday 9-5").touched).toEqual([5]);
  });
});

describe("service lists as owners write them", () => {
  it.each([
    ["Haircut £18-£25 30 mins", "Haircut", 30, 1800],
    ["Skin fade 20-25 pounds 45min", "Skin fade", 45, 2000],
    ["Mens cut 30 mins 20", "Mens cut", 30, 2000],
    ["Skin fade 45 £24", "Skin fade", 45, 2400],
    ["Skin fade (45m) - twenty five pounds", "Skin fade", 45, 2500],
    ["Haircut half an hour £20", "Haircut", 30, 2000],
    ["- Skin fade - 45 mins - £24", "Skin fade", 45, 2400],
    ["Skin fade ........ £24 ... 45 mins", "Skin fade", 45, 2400],
    ["Free consultation 15 min", "Consultation", 15, 0],
    ["Cut, wash and blow dry, 60 min, £45", "Cut, wash and blow dry", 60, 4500],
    ["Bridal makeup POA 2 hours", "Bridal makeup", 120, null],
  ])("%s", (text, name, mins, pence) => {
    const { services, unparsed } = parseServices(text as string);
    expect(unparsed).toEqual([]);
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ name, duration_min: mins, price_from_pence: pence });
  });
  it("says what it assumed about ranges and bare numbers", () => {
    expect(parseServices("Haircut £18-£25 30 mins").services[0].notes[0]).toMatch(/£18–£25/);
    expect(parseServices("Mens cut 30 mins 20").services[0].notes[0]).toMatch(/£20/);
  });
  it("splits several services on one line", () => {
    expect(parseServices("PT session 1 hr £40, Group class 45 min £10").services.map((s) => s.name)).toEqual(["PT session", "Group class"]);
  });
  it("uses heading lines as categories", () => {
    const { services } = parseServices("HAIRCUTS:\nSkin fade 45 min £24\nBEARD:\nBeard trim 20 min £10");
    expect(services.map((s) => [s.name, s.category])).toEqual([["Skin fade", "HAIRCUTS"], ["Beard trim", "BEARD"]]);
  });
});

describe("other answers as owners write them", () => {
  it.each([["(0117) 496 0123", "0117 496 0123"], ["0044 117 496 0123", "+44 117 496 0123"], ["+44 (0)117 496 0123", "+44 117 496 0123"], ["07700900123", "07700900123"]])(
    "phone %s", (t, p) => expect(parsePhone(t)).toBe(p));
  it("finds the town without commas, and tidies capitals", () => {
    expect(parseAddress("45 Market St Manchester M1 1AA")).toEqual({ address_line1: "45 Market St", city: "Manchester", postcode: "M1 1AA" });
    expect(parseAddress("flat 2 10 queen st, glasgow g1 3dn").city).toBe("Glasgow");
  });
  it.each([["Gents hairdresser", "barbershop"], ["men's grooming lounge", "barbershop"], ["massage therapist", "wellness"], ["Tattoo studio", "other"], ["dog grooming", "other"], ["garage / MOT centre", "trades"], ["cafe and bakery", "hospitality"], ["nail bar", "hair_beauty"]])(
    "type %s → %s", (t, s) => expect(parseSector(t)).toBe(s));
  it.each([["3", 3], ["three chairs", 3], ["just me", 1], ["me and 2 others", 3], ["we have 4 chairs but 2 barbers", 2], ["nothing", null]])(
    "capacity %s → %s", (t, n) => expect(parseCount(t as string)).toBe(n));
  it.each(["go ahead", "sounds good", "👍", "yep looks good", "perfect thanks", "that works"])("“%s” is a yes", (t) => expect(isYes(t)).toBe(true));
  it.each(["no that's wrong", "not quite", "yes but change saturday", "remove head shave"])("“%s” is not a yes", (t) => expect(isYes(t)).toBe(false));
  it("pulls the correction out of “yes but …”", () => {
    expect(yesBut("yes but change saturday to 9-5")).toBe("change saturday to 9-5");
    expect(yesBut("yep, but remove head shave")).toBe("remove head shave");
    expect(yesBut("yes")).toBeNull();
  });
});
