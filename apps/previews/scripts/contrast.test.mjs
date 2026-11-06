// Regression: solid Command fills under white text must meet WCAG AA (4.5:1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const rgb = (name) => css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`)).slice(1).map(Number);
const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("white on cmd-violet-strong meets WCAG AA", () => {
  assert.ok(ratio(rgb("cmd-violet-strong"), [255, 255, 255]) >= 4.5);
});

test("the original cmd-violet does not (so it must not carry white text)", () => {
  assert.ok(ratio(rgb("cmd-violet"), [255, 255, 255]) < 4.5);
});
