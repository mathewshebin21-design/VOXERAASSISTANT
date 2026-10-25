// Captures "in use" screenshots: each simulator after running the booking scenario.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const b = await chromium.launch();
for (const [name, route, label] of [["command", "/command/simulator", "Straightforward booking"], ["atelier", "/atelier/studio/rehearse", "Straightforward booking"], ["flow", "/flow/app/simulate", "Straightforward booking"]]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + route, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: label }).first().click();
  await p.waitForTimeout(22000);
  await p.screenshot({ path: `screenshots/showcase-${name}-simulator.png` });
  await p.close();
}
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(BASE + "/command/live", { waitUntil: "networkidle" });
await p.waitForTimeout(6000);
await p.screenshot({ path: "screenshots/showcase-command-live.png" });
await b.close();
