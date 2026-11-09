import { describe, expect, it } from "vitest";
import { durationLabel, eventLine, type CallEvent } from "./calls";

const ev = (over: Partial<CallEvent>): CallEvent => ({ seq: 1, at: "", kind: "utterance", speaker: "caller", text: null, data: {}, ...over });

describe("eventLine", () => {
  it("shows the caller's and receptionist's words", () => {
    expect(eventLine(ev({ text: "Hello" }))).toEqual({ who: "Caller", text: "Hello", muted: false });
    expect(eventLine(ev({ speaker: "agent", text: "Hi" })).who).toBe("Receptionist");
  });
  it("says plainly when words were not kept for consent", () => {
    expect(eventLine(ev({ data: { text_withheld: true } })).text).toContain("no recording notice");
  });
  it("describes tools and hand-offs without exposing tool results", () => {
    expect(eventLine(ev({ kind: "tool", speaker: "agent", data: { name: "check_availability", ok: true } })).text).toBe("Used check_availability");
    expect(eventLine(ev({ kind: "tool", speaker: "agent", data: { name: "book_appointment", ok: false } })).text).toContain("(failed)");
    expect(eventLine(ev({ kind: "handoff", speaker: "agent", data: { outcome: "transfer" } })).text).toBe("Handed over (transfer)");
  });
});

describe("durationLabel", () => {
  it("formats seconds and minutes", () => {
    expect(durationLabel(undefined)).toBe("—");
    expect(durationLabel(42_000)).toBe("42s");
    expect(durationLabel(125_000)).toBe("2m 05s");
  });
});
