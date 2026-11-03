import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTORS } from "../dashboards";
import { BARBERSHOP, TEMPLATES, templateFor } from "./templates";

describe("business templates", () => {
  it.each(TEMPLATES)("$label passes the API's validation rules", (t) => {
    expect(SECTORS.some((s) => s.value === t.sector)).toBe(true);
    expect(t.description.length).toBeLessThanOrEqual(4000);
    expect(new Set(t.services.map((s) => s.name.toLowerCase())).size).toBe(t.services.length);
    for (const s of t.services) {
      expect(s.name.length).toBeLessThanOrEqual(120);
      expect(s.category.length).toBeLessThanOrEqual(60);
      expect(s.duration_min).toBeGreaterThanOrEqual(5);
      expect(s.duration_min).toBeLessThanOrEqual(600);
      expect(s.buffer_min).toBeLessThanOrEqual(120);
      expect(s.price_from_pence).toBeGreaterThan(0);
    }
    for (const d of t.week) for (const p of d) expect(p.opens < p.closes).toBe(true);
  });

  it("finds the barbershop template by sector only", () => {
    expect(templateFor("barbershop")).toBe(BARBERSHOP);
    expect(templateFor("hair_beauty")).toBeNull();
    expect(templateFor(null)).toBeNull();
  });

  it("matches the copy the Claude setup assistant reads", () => {
    // The API (services/api) is deployed on its own, so it keeps its own copy of each template.
    const f = fileURLToPath(new URL("../../../../../services/api/app/live/templates/barbershop.json", import.meta.url));
    if (!existsSync(f)) return; // this app checked out on its own
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual(JSON.parse(JSON.stringify(BARBERSHOP)));
  });
});
