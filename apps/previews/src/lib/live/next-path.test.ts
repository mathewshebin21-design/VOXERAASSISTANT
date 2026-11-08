import { describe, expect, it } from "vitest";
import { safeNext, signInHref } from "./next-path";

describe("safeNext", () => {
  it.each([
    ["/start/design", "/start/design"],
    ["/start/design?new=1", "/start/design?new=1"],
    ["/command/ops", "/command/ops"],
    ["/atelier/studio", "/atelier/studio"],
    ["/flow/app/calls", "/flow/app/calls"],
  ])("accepts app page %s", (raw, want) => expect(safeNext(raw)).toBe(want));

  it.each([
    null,
    "",
    "https://evil.example/start/design",
    "//evil.example/start/design",
    "/\\evil.example",
    "/start/../../evil",
    "javascript:alert(1)",
    "/api/v1/me",
    "/start",
    "/commander",
    "/start/design x",
    "/" + "a".repeat(250),
  ])("rejects %s", (raw) => expect(safeNext(raw)).toBeNull());

  it("builds an encoded sign-in link that round-trips", () => {
    const href = signInHref("/start/design");
    expect(href).toBe("/start?next=%2Fstart%2Fdesign");
    expect(safeNext(new URL(href, "https://x.test").searchParams.get("next"))).toBe("/start/design");
  });
});
