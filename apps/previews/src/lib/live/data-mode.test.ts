import { describe, expect, it } from "vitest";
import { dataModeFor } from "./data-mode";

const base = { status: "signed_in" as const, hydrated: true, hasOrg: true, demoOn: false, orgsError: null };

describe("dataModeFor", () => {
  it("waits while the session or the demo choice is loading", () => {
    expect(dataModeFor({ ...base, status: "loading" })).toBe("loading");
    expect(dataModeFor({ ...base, hydrated: false })).toBe("loading");
  });
  it("shows the real workspace when signed in with one", () => {
    expect(dataModeFor(base)).toBe("live");
  });
  it("shows demo data to visitors who are not signed in", () => {
    expect(dataModeFor({ ...base, status: "anonymous", hasOrg: false })).toBe("demo");
  });
  it("shows demo data only when a signed-in user chose it", () => {
    expect(dataModeFor({ ...base, demoOn: true })).toBe("demo");
    expect(dataModeFor({ ...base, hasOrg: false, orgsError: "Service unavailable", demoOn: true })).toBe("demo");
  });
  it("never substitutes demo data when the workspace list failed", () => {
    expect(dataModeFor({ ...base, hasOrg: false, orgsError: "Service unavailable" })).toBe("unavailable");
    expect(dataModeFor({ ...base, hasOrg: false, orgsError: "Network error" })).toBe("unavailable");
  });
  it("a workspace that loaded wins over a stale error", () => {
    expect(dataModeFor({ ...base, orgsError: "old" })).toBe("live");
  });
});
