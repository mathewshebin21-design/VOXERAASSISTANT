// Recorded calls on the Calls page against the real VOXERA API (call records, migration 0011):
// list, transcript, consent-withheld words, and owner erasure. Simulated calls only; no provider.
// Usage: BASE_URL=http://localhost:3000 node scripts/e2e-calls.mjs [--shot path.png]
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const shot = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const who = { name: "Sam Okafor", email: `calls-${run}@calls.example`, org: `Okafor Dental ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const step = async (name, fn) => { try { const r = await fn(); check(name, r !== false && typeof r !== "string", typeof r === "string" ? r : ""); } catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 220)); } };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => check("no page errors", false, e.message));
page.on("dialog", (d) => d.accept());
const call = (method, path, body) => page.evaluate(async ([m, u, x]) => {
  const r = await fetch(`/api/v1${u}`, { method: m, headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: x ? JSON.stringify(x) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, path, body]);
let org = "";

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
    org = (await call("GET", "/me/organizations")).json[0].organization.id;
  });

  await step("an empty workspace says no calls are recorded yet", async () => {
    await page.goto(`${BASE}/flow/app/calls`, { waitUntil: "networkidle" });
    await page.getByTestId("live-calls").waitFor({ timeout: 10000 });
    return (await page.getByTestId("live-calls").innerText()).includes("No calls recorded yet");
  });

  await step("record two simulated calls through the API (one without the recording notice)", async () => {
    const a = await call("POST", `/orgs/${org}/calls`, { channel: "simulated", caller_name: "Priya", recording_notice_played: true, ai_disclosure_played: true });
    const b = await call("POST", `/orgs/${org}/calls`, { channel: "simulated", caller_name: "Tom", recording_notice_played: false });
    const ev = [{ kind: "utterance", speaker: "caller", text: "Can I book a check-up?" }, { kind: "tool", speaker: "agent", data: { name: "check_availability", ok: true } }, { kind: "utterance", speaker: "agent", text: "Tuesday at ten works." }];
    for (const c of [a, b]) {
      if ((await call("POST", `/orgs/${org}/calls/${c.json.id}/events`, { events: ev })).status !== 201) return "events failed";
      if ((await call("POST", `/orgs/${org}/calls/${c.json.id}/end`, { status: "completed", outcome: "answered" })).status !== 200) return "end failed";
    }
    return a.status === 201 && b.status === 201;
  });

  await step("both calls are listed with status, channel and outcome", async () => {
    await page.reload({ waitUntil: "networkidle" });
    const rows = page.getByTestId("call-row");
    await rows.first().waitFor({ timeout: 10000 });
    const text = await page.getByTestId("live-calls").innerText();
    return (await rows.count()) === 2 && text.includes("Priya") && text.includes("Tom") && text.includes("Completed") && text.includes("Simulated") && text.includes("answered");
  });

  await step("a transcript shows the words, tools and consent state", async () => {
    await page.getByTestId("call-row").filter({ hasText: "Priya" }).click();
    const t = page.getByTestId("call-transcript");
    await t.waitFor({ timeout: 10000 });
    const text = await t.innerText();
    return text.includes("Can I book a check-up?") && text.includes("Used check_availability") && text.includes("recording notice played") && text.includes("no audio stored");
  });

  await step("without the recording notice, the words are not shown and the page says why", async () => {
    await page.getByTestId("call-row").filter({ hasText: "Tom" }).click();
    await page.getByTestId("call-transcript").getByText("recording notice not played").waitFor({ timeout: 10000 });
    const text = await page.getByTestId("call-transcript").innerText();
    return !text.includes("Can I book a check-up?") && text.includes("words not kept: no recording notice was played");
  });

  if (shot) await page.screenshot({ path: shot, fullPage: false });

  await step("the owner erases a call and it is gone", async () => {
    await page.getByTestId("erase-call").click();
    await page.getByText("Call and transcript erased.").waitFor({ timeout: 10000 });
    return (await page.getByTestId("call-row").count()) === 1 && !(await page.getByTestId("live-calls").innerText()).includes("Tom");
  });

  await step("clean up the synthetic account", async () => (await call("DELETE", "/me", { password: PW })).status === 204);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
