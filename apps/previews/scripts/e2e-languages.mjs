// Languages page against the real VOXERA API (ADR-0006): the registry with honest evidence labels,
// the route preview under data-residency settings, and the providers' status. Calls no provider.
// Usage: BASE_URL=http://localhost:3000 node scripts/e2e-languages.mjs [--shot path.png]
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const shot = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const who = { name: "Asha Nair", email: `lang-${run}@languages.example`, org: `Nair Studio ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const step = async (name, fn) => { try { const r = await fn(); check(name, r !== false && typeof r !== "string", typeof r === "string" ? r : ""); } catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 220)); } };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => check("no page errors", false, e.message));
const call = (method, path, body) => page.evaluate(async ([m, u, x]) => {
  const r = await fetch(`/api/v1${u}`, { method: m, headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: x ? JSON.stringify(x) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, path, body]);

try {
  await step("create a workspace and choose Flow", async () => {
    await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Create workspace" }).click();
    await page.getByLabel("Your name").fill(who.name);
    await page.getByLabel("Business name").fill(who.org);
    await page.getByLabel("Email").fill(who.email);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Create workspace", exact: true }).last().click();
    await page.waitForURL("**/start/design?new=1", { timeout: 15000 });
    await page.getByTestId("design-flow").getByRole("button", { name: "Use for everyone" }).click();
    await page.waitForURL("**/flow/**", { timeout: 15000 });
  });

  await step("Languages is in the navigation and the registry loads", async () => {
    await page.getByRole("link", { name: "Languages" }).first().click();
    await page.waitForURL("**/flow/app/languages", { timeout: 15000 });
    await page.getByTestId("language-table").getByText("Malayalam").waitFor({ timeout: 10000 });
    const text = await page.getByTestId("language-table").innerText();
    return ["Hindi", "Arabic (Saudi Arabia)", "English (United Kingdom)"].every((n) => text.includes(n));
  });

  await step("nothing is labelled tested by VOXERA; vendor claims are labelled as such", async () => {
    const text = await page.getByTestId("language-table").innerText();
    return !text.includes("Tested by VOXERA") && text.includes("Vendor says so") && text.includes("Unverified");
  });

  await step("Arabic and Malayalam names render in their own scripts, Arabic right to left", async () => {
    const ar = page.locator('[lang="ar-SA"]');
    return (await ar.getAttribute("dir")) === "rtl" && (await ar.innerText()).includes("العربية")
      && (await page.locator('[lang="ml-IN"]').innerText()).includes("മലയാളം");
  });

  await step("route preview explains why nothing is routable without a model key (stand-ins off)", async () => {
    await page.getByTestId("route-language").selectOption("hi-IN");
    await page.getByTestId("route-preview").click();
    const result = page.getByTestId("route-result");
    await result.waitFor({ timeout: 10000 });
    const text = await result.innerText();
    const api = await call("GET", "/me/organizations");
    const org = api.json[0].organization.id;
    const reg = await call("GET", `/orgs/${org}/voice/languages`);
    const llmConfigured = reg.json.providers.some((p) => p.kind === "llm" && p.configured);
    // In CI the stand-in model is configured as Anthropic, which is paid: not allowed by default here.
    return llmConfigured || text.includes("can't be routed") ? true : `unexpected: ${text.slice(0, 160)}`;
  });

  await step("allowing paid providers routes Hindi, or falls back honestly, and never to a candidate", async () => {
    await page.getByLabel(/Allow paid providers/).check();
    await page.getByTestId("route-preview").click();
    await page.waitForTimeout(500);
    const text = await page.getByTestId("route-result").innerText();
    return !/Deepgram|Google Cloud Speech/.test(text) ? true : `routed to a candidate: ${text}`;
  });

  await step("UK-only processing blocks US-processed providers, with the reason", async () => {
    for (const r of ["eu", "us", "global"]) {
      const box = page.getByTestId(`region-${r}`);
      if (await box.isChecked()) await box.uncheck();
    }
    await page.getByTestId("route-preview").click();
    await page.waitForTimeout(500);
    const text = await page.getByTestId("route-result").innerText();
    return text.includes("can't be routed") || text.includes("would continue in") || text.includes("would use")
      ? !/Anthropic Claude|ElevenLabs/.test(text.split("\n").slice(1).join("\n")) || `US provider used: ${text}`
      : `unexpected: ${text}`;
  });

  await step("launch readiness shows every profiled country blocked, with its outstanding checks", async () => {
    const text = await page.getByTestId("launch-table").innerText();
    return text.includes("United Kingdom") && text.includes("India") && !/\bready\b/.test(text.replace(/readiness/g, ""))
      && text.includes("Emergency and urgent-advice numbers");
  });

  if (shot) await page.screenshot({ path: shot, fullPage: true });

  await step("clean up the synthetic account", async () => (await call("DELETE", "/me", { password: PW })).status === 204);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
