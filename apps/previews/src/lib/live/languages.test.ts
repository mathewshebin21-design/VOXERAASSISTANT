import { describe, expect, it } from "vitest";
import { buildPolicy, describeRoute, type RoutePolicy } from "./languages";

const base: RoutePolicy = {
  language: "hi-IN",
  languages: ["en-GB"],
  default_language: "en-GB",
  fallback_language: "en-GB",
  allowed_regions: ["device", "uk"],
  allow_paid: false,
  allow_unverified: false,
};

describe("buildPolicy", () => {
  it("always includes the call language and the default", () => {
    expect(buildPolicy(base).languages).toEqual(["en-GB", "hi-IN"]);
  });
  it("drops a fallback the workspace does not speak", () => {
    expect(buildPolicy({ ...base, fallback_language: "ar-SA" }).fallback_language).toBeNull();
  });
  it("never sends an empty region list (the device always counts)", () => {
    expect(buildPolicy({ ...base, allowed_regions: [] }).allowed_regions).toEqual(["device"]);
  });
});

describe("describeRoute", () => {
  const names = { "hi-IN": "Hindi", "en-GB": "English (United Kingdom)" };
  it("explains a fallback honestly", () => {
    const text = describeRoute(
      { routable: true, language: "en-GB", requested: "hi-IN", language_fallback: true, stt: "a", llm: "b", tts: "c", evidence: {}, reasons: [] },
      names,
    );
    expect(text).toBe("Hindi isn't available under these settings, so the call would continue in English (United Kingdom).");
  });
  it("names the missing parts when nothing is routable", () => {
    const text = describeRoute({ routable: false, language: "hi-IN", gaps: { llm: "x", tts: "y" } }, names);
    expect(text).toContain("the language model, speech output");
  });
});
