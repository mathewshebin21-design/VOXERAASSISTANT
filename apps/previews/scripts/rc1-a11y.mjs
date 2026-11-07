// Accessibility scan (axe-core, WCAG 2.1 A/AA rules) of the public entry pages.
// Fails on serious or critical violations; records every violation in the evidence file.
// Usage: BASE_URL=<web> node scripts/rc1-a11y.mjs [evidence.json]
// Needs: npm i --no-save playwright@1.63.0 axe-core@4.10.3
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axe = require("axe-core");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "rc1-a11y.json";
const PAGES = ["/", "/start", "/flow/enter", "/command", "/command/login", "/atelier", "/atelier/sign-in"];
const BLOCKING = new Set(["serious", "critical"]);

const browser = await chromium.launch();
const report = [];
let blocking = 0;
for (const path of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.addScriptTag({ content: axe.source });
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
  // keyboard: the first Tab lands on a focusable, visible element
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body ? (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 60) : null;
  });
  const violations = res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
  const bad = violations.filter((v) => BLOCKING.has(v.impact));
  blocking += bad.length + (focused ? 0 : 1);
  console.log(`${bad.length || !focused ? "FAIL" : "PASS"}  ${path}: ${violations.length} violations (${bad.length} serious/critical), first Tab focus: ${focused ?? "none"}`);
  for (const v of violations) console.log(`      ${v.impact.padEnd(8)} ${v.id} ×${v.nodes} — ${v.help}`);
  report.push({ path, passes: res.passes.length, violations, firstTabFocus: focused });
  await page.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify({ base: BASE, axe: axe.version, report }, null, 2));
process.exit(blocking ? 1 : 0);
