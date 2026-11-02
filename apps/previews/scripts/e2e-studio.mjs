// Agent Studio against the real VOXERA API and PostgreSQL, in a real browser.
// Usage: BASE_URL=http://localhost:3100 [SHOTS=dir] [FAILURES=dir] node scripts/e2e-studio.mjs
// On a failed step the full error (with stack), a screenshot and the visible page text are kept
// in FAILURES (default: e2e-failures/) so an intermittent failure can be diagnosed afterwards.
import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const FAILURES = process.env.FAILURES ?? "e2e-failures";
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const me = { name: "Ewa Wright", email: `ewa-${run}@e2e.example`, org: `EW Saloon ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
const keepFailure = async (name, e) => {
  console.log(String(e?.stack ?? e)); // the whole error, including Playwright's call log
  try {
    mkdirSync(FAILURES, { recursive: true });
    const base = `${FAILURES}/studio-${run}-${slug(name)}`;
    await p.screenshot({ path: `${base}.png`, fullPage: true });
    writeFileSync(`${base}.txt`, `${String(e?.stack ?? e)}\n\n--- visible page text ---\n${await p.locator("body").innerText()}`);
    console.log(`      kept: ${base}.png, ${base}.txt`);
  } catch (err) { console.log(`      (couldn't keep failure details: ${err})`); }
};
const step = async (name, fn) => {
  try { const r = await fn(); check(name, r !== false, typeof r === "string" ? r : ""); if (r === false || typeof r === "string") await keepFailure(name, r || "check returned false"); }
  catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 240)); await keepFailure(name, e); }
};
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
p.on("pageerror", (e) => check("no page errors", false, e.message));
const call = (method, path, body) => p.evaluate(async ([m, u, b]) => {
  const r = await fetch(`/api/v1${u}`, { method: m, headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, path, body]);
let orgId;

// Waits for a real state, not a fixed time: the API holds a draft matching `ok`, and the page's
// save badge reports that draft as saved. (Waiting for the badge text alone can match the badge
// from before the edit, before the page has even noticed the change.)
const draftSaved = async (ok, label) => {
  const agent = (await call("GET", `/orgs/${orgId}/agents`)).json[0].id;
  const deadline = Date.now() + 15000;
  let last = "";
  while (Date.now() < deadline) {
    const flow = (await call("GET", `/orgs/${orgId}/agents/${agent}/flow`)).json;
    last = (await p.getByTestId("save-state").innerText()).trim();
    if (ok(flow.draft) && last === "draft saved") return flow;
    await p.waitForTimeout(150);
  }
  throw new Error(`${label}: the saved draft never matched with the badge on "draft saved" (badge: "${last}")`);
};
// Clicks only once the control is enabled, and says why if it never becomes enabled.
const clickEnabled = async (locator, what) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return locator.click();
    await p.waitForTimeout(150);
  }
  const badge = (await p.getByTestId("save-state").innerText().catch(() => "?")).trim();
  throw new Error(`${what} stayed disabled for 15s (save badge: "${badge}", title: "${await locator.getAttribute("title")}")`);
};
const closedMessage = (draft) => draft.nodes.find((n) => n.id === "closed").settings.message;

await step("set up a workspace with services, hours and a receptionist", async () => {
  await p.goto(`${BASE}/flow/enter?mode=signup`, { waitUntil: "networkidle" });
  await p.getByLabel("Your name").fill(me.name);
  await p.getByLabel("Business name").fill(me.org);
  await p.getByLabel("Email").fill(me.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Create workspace" }).click();
  await p.waitForURL("**/flow/app", { timeout: 15000 });
  orgId = (await call("GET", "/me/organizations")).json[0].organization.id;
  const b = `/orgs/${orgId}`;
  await call("PUT", `${b}/office-hours`, { intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "00:00", closes_at: "23:59" })) });
  await call("PUT", `${b}/business-profile`, { display_name: "EW Saloon", address_line1: "12 High Street", city: "Leeds" });
  for (const [name, duration_min, price_from_pence] of [["Skin fade", 30, 2000], ["Beard trim", 15, 1000]]) await call("POST", `${b}/services`, { name, duration_min, price_from_pence });
  return (await call("POST", `${b}/agents`, { name: "Ray", greeting: "Hi, you're through to EW Saloon. I'm Ray, the AI receptionist. How can I help?" })).status === 201;
});

await step("Studio opens the agent's flow on an editable canvas", async () => {
  await p.goto(`${BASE}/flow/app/studio`, { waitUntil: "networkidle" });
  await p.getByTestId("studio-canvas").waitFor({ timeout: 15000 });
  await p.getByTestId("node-start").waitFor();
  await p.getByText("ready to publish").waitFor({ timeout: 10000 });
  await shot(p, "1-studio-canvas");
  return (await p.locator("[data-testid^=node-]").count()) >= 15;
});

await step("selecting a step opens its settings; edits autosave", async () => {
  await p.getByTestId("node-closed").click();
  const msg = p.getByTestId("inspector").getByLabel("Message");
  await msg.fill("We're closed right now. I can take a message and the team will call you back first thing.");
  const flow = await draftSaved((d) => closedMessage(d).includes("first thing"), "edit autosave");
  await shot(p, "2-inspector");
  return flow.revision > 1;
});

await step("undo and redo", async () => {
  await p.getByRole("button", { name: "Undo" }).click();
  const back = await p.getByTestId("inspector").getByLabel("Message").inputValue();
  await p.getByRole("button", { name: "Redo" }).click();
  const again = await p.getByTestId("inspector").getByLabel("Message").inputValue();
  return !back.includes("first thing") && again.includes("first thing");
});

await step("adding an unconnected step shows the problem and blocks publishing", async () => {
  await p.getByRole("button", { name: "Add Say something" }).click();
  await p.getByText(/to fix/).waitFor({ timeout: 10000 });
  const disabled = await p.getByRole("button", { name: "Publish", exact: true }).isDisabled();
  await p.getByTestId("inspector").getByRole("button", { name: "Delete step" }).click();
  await p.getByText("ready to publish").waitFor({ timeout: 10000 });
  return disabled;
});

await step("change by asking: proposal with before → after, applied only on confirm", async () => {
  await p.getByLabel("Describe a change").fill("Don't accept appointments on Sundays.");
  await p.getByRole("button", { name: "Propose" }).click();
  await p.getByText("No appointments will be offered on Sundays").waitFor({ timeout: 10000 });
  await p.getByText("high impact").waitFor();
  await shot(p, "3-change-by-asking");
  await p.getByRole("button", { name: "Apply to draft" }).click();
  await draftSaved((d) => JSON.stringify(d.nodes.find((n) => n.type === "availability").settings.exclude_weekdays) === "[6]", "applied proposal");
  return true;
});

await step("test call: books through the draft, path lights up, nothing saved", async () => {
  await p.getByRole("tab", { name: "Test call" }).click();
  await p.getByRole("button", { name: "Test the draft" }).click();
  const say = async (t, expect) => {
    await p.getByLabel("Say as the caller").fill(t);
    await p.getByRole("button", { name: "Send" }).click();
    await p.getByTestId("test-call").getByText(expect).last().waitFor({ timeout: 10000 });
  };
  await say("Hi, can I book a skin fade tomorrow?", /I could do/);
  await say("the first one", /What name/);
  await say("Sam Lee", /Shall I book it/);
  await say("yes please", /You're booked in/);
  await shot(p, "4-test-call");
  const appts = (await call("GET", `/orgs/${orgId}/appointments`)).json;
  return appts.length === 0 && (await p.getByTestId("test-call").getByText(/valid booking \(simulation: not saved\)/).count()) === 1;
});

await step("testing lab: the twelve standard scenarios pass on the draft", async () => {
  await p.getByRole("tab", { name: "Tests" }).click();
  await p.getByRole("button", { name: "Run all on the draft" }).click();
  await p.getByTestId("suite-results").getByText("12/12 passed").waitFor({ timeout: 30000 });
  await p.getByRole("button", { name: /Book an appointment/ }).click();
  await shot(p, "5-tests");
  return (await p.getByText(/voice, speech recognition and phone-line latency aren't tested/).count()) >= 1;
});

await step("publish runs the tests and makes v1 live", async () => {
  await clickEnabled(p.getByRole("button", { name: "Publish", exact: true }), "Publish");
  await p.getByLabel("What changed").fill("First version");
  await p.getByRole("button", { name: "Run tests and publish" }).click();
  await p.getByText("live v1").waitFor({ timeout: 30000 });
  return true;
});

await step("after publishing, every step is still drawn on the canvas", async () => {
  // Regression: nodes rebuilt without their measured size were left hidden (blank canvas).
  await p.waitForFunction(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    return nodes.length >= 15 && nodes.every((n) => getComputedStyle(n).visibility === "visible");
  }, null, { timeout: 5000 });
  return true;
});

await step("a failing test blocks publishing and shows why", async () => {
  const agent = (await call("GET", `/orgs/${orgId}/agents`)).json[0].id;
  const t = await call("POST", `/orgs/${orgId}/agents/${agent}/flow/tests`, { scenario: { name: "Mentions parking", lines: ["is there parking?"], assertions: [{ type: "says", value: "free parking" }] } });
  await p.getByTestId("node-closed").click();
  await p.getByTestId("inspector").getByLabel("Message").fill("We're closed right now, but I can take a message.");
  await draftSaved((d) => closedMessage(d) === "We're closed right now, but I can take a message.", "second edit autosave");
  await clickEnabled(p.getByRole("button", { name: "Publish", exact: true }), "Publish");
  await p.getByRole("button", { name: "Run tests and publish" }).click();
  await p.getByText("Not published: some tests failed.").waitFor({ timeout: 30000 });
  await shot(p, "6-publish-blocked");
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await call("DELETE", `/orgs/${orgId}/agents/${agent}/flow/tests/${t.json.id}`);
  await clickEnabled(p.getByRole("button", { name: "Publish", exact: true }), "Publish");
  await p.getByRole("button", { name: "Run tests and publish" }).click();
  await p.getByText("live v2").waitFor({ timeout: 30000 });
  return true;
});

await step("versions: roll back to v1 (published as v3)", async () => {
  await p.getByRole("tab", { name: "Versions" }).click();
  p.once("dialog", (d) => d.accept());
  await p.getByTestId("versions-panel").getByRole("button", { name: "Make live" }).last().click();
  await p.getByText("live v3").waitFor({ timeout: 15000 });
  await p.getByText("rollback of v1").waitFor();
  await shot(p, "7-versions");
  return true;
});

await step("insights are labelled as simulated and count the test call", async () => {
  await p.getByRole("tab", { name: "Insights" }).click();
  await p.getByText("Simulated conversations (not real callers)").waitFor({ timeout: 10000 });
  await shot(p, "8-insights");
  return (await p.getByTestId("insights-panel").getByText("100% (1/1)").count()) === 1;
});

await step("a slow save still finishes: the badge reaches 'draft saved' and Publish re-enables", async () => {
  // Regression: a save slower than the 900 ms debounce left the page on "unsaved" for good.
  const slow = async (r) => { if (r.request().method() === "PUT") await new Promise((s) => setTimeout(s, 1500)); await r.continue(); };
  await p.route("**/flow/draft", slow);
  try {
    await p.getByRole("tab", { name: "Step" }).click();
    await p.getByTestId("node-closed").click();
    await p.getByTestId("inspector").getByLabel("Message").fill("We're closed. Leave a message and we'll call you back.");
    await draftSaved((d) => closedMessage(d) === "We're closed. Leave a message and we'll call you back.", "slow save");
    return await p.getByRole("button", { name: "Publish", exact: true }).isEnabled() || "Publish stayed disabled";
  } finally { await p.unroute("**/flow/draft", slow); }
});

await step("mobile: the Studio stacks and stays usable", async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/flow/app/studio`, { waitUntil: "networkidle" });
  await p.getByTestId("studio-canvas").waitFor({ timeout: 15000 });
  await shot(p, "9-mobile");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  return overflow <= 2 ? true : `horizontal overflow ${overflow}px`;
});

await step("clean-up: delete the test account and its workspace", async () => (await call("DELETE", "/me", { password: PW })).status === 204);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} studio checks passed`);
process.exit(failed.length ? 1 : 0);
