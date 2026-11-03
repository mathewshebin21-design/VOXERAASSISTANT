import { describe, expect, it } from "vitest";
import { matchServices, practiceInitial, practiceReply, type Catalog, type PracticeState } from "./practice";
import type { SimEvent } from "../simulator";
import { speakable, pickVoice, spokenClock } from "../voice/natural";

const catalog: Catalog = {
  business: "EW Saloon", agentName: "Ray", timezone: "Europe/London",
  services: [
    { id: "s1", name: "Skin fade", category: null, durationMin: 30, pricePence: 2000, requiresPatchTest: false, bookable: true },
    { id: "s2", name: "Beard trim", category: null, durationMin: 15, pricePence: 1000, requiresPatchTest: false, bookable: true },
    { id: "s3", name: "Hair colour", category: null, durationMin: 90, pricePence: 4500, requiresPatchTest: true, bookable: true },
    { id: "s4", name: "Kids cut", category: null, durationMin: 20, pricePence: 1200, requiresPatchTest: false, bookable: true },
    { id: "s5", name: "Mens cut", category: null, durationMin: 30, pricePence: 1800, requiresPatchTest: false, bookable: true },
  ],
  hours: [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "09:00", closes: "18:00" })),
  address: "12 High Street, Leeds, LS1 1AA", phone: "01131234567", email: null, website: null, description: null, allowTransfer: true,
};
// Monday 3 Nov 2025, 10:00 London.
const NOW = new Date("2025-11-03T10:00:00Z");
const slots = async (_id: string, on?: string) => {
  const d = on ?? "2025-11-04";
  return [`${d}T09:30:00Z`, `${d}T11:00:00Z`, `${d}T14:30:00Z`];
};

async function chat(lines: string[]) {
  let s: PracticeState = practiceInitial();
  const all: SimEvent[][] = [];
  for (const l of lines) { const r = await practiceReply(l, s, catalog, slots, NOW); s = r.state; all.push(r.events); }
  const said = all.map((evs) => evs.filter((e) => e.kind === "agent").map((e) => (e as { text: string }).text).join(" "));
  return { s, said, all };
}

describe("practice receptionist — answers the question asked, from the workspace's details", () => {
  it("lists the workspace's real services with prices", async () => {
    const { said } = await chat(["Okay great what all services do you offer"]);
    expect(said[0]).toMatch(/Skin fade \(from £20\).*Beard trim \(from £10\).*Hair colour.*Kids cut/);
    expect(said[0]).not.toMatch(/not sure|put you through/);
  });

  it("explains a service mid-booking instead of jumping to times, then resumes", async () => {
    const { said, s, all } = await chat(["I'd like to book a skin fade", "What's a skin fade?"]);
    expect(said[1]).toMatch(/Skin fade is a 30 minutes appointment, and it starts from £20/);
    expect(said[1]).toMatch(/look for a time/);
    expect(all[1].some((e) => e.kind === "tool" && e.name === "check_availability")).toBe(false);
    expect(s.stage).toBe("need_time");
  });

  it("asks which one when words match more than one service", async () => {
    const { said, s } = await chat(["can I book a cut", "the kids one"]);
    expect(said[0]).toMatch(/Kids cut.*or Mens cut|Mens cut.*or Kids cut/);
    expect(s.serviceId).toBe("s4");
  });

  it("offers real availability and books only after confirmation", async () => {
    const { said, s, all } = await chat(["Can I book a beard trim tomorrow afternoon?", "2:30 please", "Sam Lee", "yes"]);
    expect(all[0].some((e) => e.kind === "tool" && e.name === "check_availability")).toBe(true);
    expect(said[0]).toMatch(/14:30/);
    expect(said[2]).toMatch(/Shall I book that/);
    expect(s.stage).toBe("booked");
    expect(all[3].some((e) => e.kind === "tool" && e.name === "book_appointment" && /not written/.test(e.result))).toBe(true);
  });

  it("answers hours, address, price and duration", async () => {
    const { said } = await chat(["Are you open on Sunday?", "Where are you?", "How much is a beard trim?", "How long does hair colour take?"]);
    expect(said[0]).toMatch(/closed on Sundays/);
    expect(said[1]).toMatch(/12 High Street/);
    expect(said[2]).toMatch(/£10/);
    expect(said[3]).toMatch(/an hour 30 minutes|1 hour 30 minutes/);
  });

  it("says plainly when something isn't offered, and hands over for real unknowns", async () => {
    const { said, s } = await chat(["Do you do eyelash extensions?", "Is the owner's dog friendly?", "yes"]);
    expect(said[0]).toMatch(/don't see eyelash extensions/);
    expect(said[1]).toMatch(/put you through/);
    expect(s.stage).toBe("transferred");
  });

  it("matches services by their words", () => {
    expect(matchServices("a fade please", catalog.services).map((x) => x.id)).toEqual(["s1"]);
  });
});

describe("natural voice", () => {
  it("reads times the way people say them", () => {
    expect(speakable("tomorrow at 14:30 — or 09:00")).toBe("tomorrow at half past two, or nine o'clock in the morning");
    expect(spokenClock(12, 0)).toBe("midday");
    expect(spokenClock(16, 45)).toBe("quarter to five");
  });
  it("prefers natural voices over flat or novelty ones", () => {
    const v = (name: string, lang = "en-GB") => ({ name, lang, localService: true, default: false, voiceURI: name }) as SpeechSynthesisVoice;
    expect(pickVoice([v("eSpeak English"), v("Daniel"), v("Microsoft Sonia Online (Natural) - English (United Kingdom)")])?.name).toMatch(/Sonia/);
    expect(pickVoice([v("Zarvox", "en-US"), v("Kate")])?.name).toBe("Kate");
  });
});

describe("talks like a person, not a menu", () => {
  const replies = async (lines: string[]) => {
    let s: PracticeState = practiceInitial();
    const out: string[] = [];
    for (const l of lines) {
      const r = await practiceReply(l, s, catalog, slots, NOW);
      s = r.state;
      out.push(r.events.filter((e): e is Extract<SimEvent, { kind: "agent" }> => e.kind === "agent").map((e) => e.text).join(" "));
    }
    return out;
  };

  it.each(["heyy", "hiii", "helloo", "yo", "hey there", "good morning!", "hiya"])("“%s” is a greeting", async (g) => {
    expect((await replies([g]))[0]).toMatch(/^Hi there!/);
  });

  it("answers small talk and “what do you know” instead of giving up", async () => {
    const [how, know, robot, can] = await replies(["how are you?", "what do you know", "are you a robot", "what can you do"]);
    expect(how).toMatch(/doing really well, thanks for asking/);
    expect(know).toMatch(/I'm Ray, the AI receptionist for EW Saloon\. I can tell you what we offer/);
    expect(robot).toMatch(/^Yes, I'm an AI/);
    expect(can).toMatch(/I can book you in/);
  });

  it("handles a greeting and a question in one message", async () => {
    expect((await replies(["hi, how much is a skin fade?"]))[0]).toMatch(/^Hi! Skin fade starts from £20/);
  });

  it("keeps off-topic chat friendly, and asks again before offering a person", async () => {
    const [weather, a, b] = await replies(["what's the weather like", "asdfgh", "blorp"]);
    expect(weather).toMatch(/I wish I could help with that/);
    expect(a).toMatch(/didn't quite follow that\. I can help with booking/);
    expect(b).toMatch(/still not quite following\. Would you like me to put you through/);
    expect([weather, a, b].join(" ")).not.toMatch(/good question/);
  });
});
