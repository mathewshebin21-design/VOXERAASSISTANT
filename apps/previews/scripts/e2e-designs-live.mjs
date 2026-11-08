// Command (A) and Atelier (B) against the real VOXERA API and PostgreSQL:
// sign up / sign in in each design's own form, real workspace data on their dashboards
// (with empty states for a new workspace), and "Explore with demo data" as a separate mode.
// Usage: BASE_URL=http://localhost:3100 node scripts/e2e-designs-live.mjs
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const me = { name: "Nadia Ahmed", email: `nadia-${run}@e2e.example`, org: `Ahmed Physio ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const step = async (name, fn) => { try { const r = await fn(); check(name, r !== false && typeof r !== "string", typeof r === "string" ? r : ""); } catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 220)); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => check("no page errors", false, e.message));
const apiCall = (method, path, body) => p.evaluate(async ([m, u, b]) => {
  const r = await fetch(`/api/v1${u}`, { method: m, headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, path, body]);
let orgId = "";

await step("Command: create a workspace in Command's own form", async () => {
  await p.goto(`${BASE}/command/login`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: "Create workspace" }).click();
  await p.getByLabel("Your name").fill(me.name);
  await p.getByLabel("Business name").fill(me.org);
  await p.getByLabel("Email").fill(me.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Create workspace", exact: true }).last().click();
  await p.waitForURL("**/command/ops", { timeout: 15000 });
  await p.getByText(`Live · ${me.org}`).waitFor({ timeout: 10000 });
  orgId = (await apiCall("GET", "/me/organizations")).json[0].organization.id;
  return (await p.getByTestId("cmd-workspace").innerText()) === me.org;
});

await step("Command: a new workspace shows setup steps and honest empty states, not demo data", async () => {
  await p.getByTestId("cmd-setup").waitFor({ timeout: 10000 });
  const body = await p.locator("main").innerText();
  return /welcome to/i.test(body) && /0\/6 done/.test(body) && /No bookings yet/.test(body) && /Nobody waiting/.test(body) && (await p.getByTestId("cmd-no-calls").count()) === 1
    && !/Simulated data|Halden/.test(body);
});

await step("signed in, Pulse shows the real workspace and points to the setup assistant", async () => {
  await p.goto(`${BASE}/flow/app`, { waitUntil: "networkidle" });
  await p.getByTestId("pulse-setup").waitFor({ timeout: 10000 });
  return (await p.getByText("James Turner").count()) === 0 && (await p.getByText("synthetic records").count()) === 0;
});

await step("setup assistant (guided): a conversation fills in the workspace", async () => {
  await p.getByRole("button", { name: /Start the setup assistant/ }).click();
  await p.waitForURL("**/flow/app/setup");
  const chat = p.getByTestId("setup-chat");
  const answer = async (text, expect) => {
    await p.getByLabel("Your answer").fill(text);
    await p.getByRole("button", { name: "Send" }).click();
    await chat.getByText(expect).last().waitFor({ timeout: 10000 });
  };
  await chat.getByText(/What kind of business/).waitFor({ timeout: 10000 });
  await answer("we're a hair salon", /phone number/);
  await answer("0117 496 0123", /address/);
  await answer("12 High Street, Bristol, BS1 4DJ", /When are you open/);
  await answer("Tue-Sat 9-5:30, Sun and Mon closed", /Shall I save these hours/);
  await answer("yes", /What can customers book/);
  await p.getByLabel("Your answer").fill("Women's cut, 60 min, £45\nGents cut 30 min £20");
  await p.getByRole("button", { name: "Send" }).click();
  await chat.getByText(/Shall I save these/).last().waitFor({ timeout: 10000 });
  await answer("yes", /at the same time/);
  await answer("2", /receptionist be called/);
  await answer("Ava", /essentials done/);
  const state = await p.evaluate(async (id) => {
    const g = async (u) => (await fetch(`/api/v1/orgs/${id}${u}`)).json();
    return { profile: await g("/business-profile"), hours: await g("/office-hours"), services: await g("/services"), settings: await g("/settings"), agents: await g("/agents") };
  }, orgId);
  return state.profile.phone === "0117 496 0123" && state.profile.city === "Bristol" && state.hours.intervals.length === 5
    && state.services.some((s) => s.name === "Gents cut" && s.price_from_pence === 2000) && state.settings.booking_capacity === 2
    && state.agents.some((a) => a.name === "Ava" && /AI receptionist/.test(a.greeting));
});

await step("setup assistant (guided): removing a service then 'undo' brings back the same service", async () => {
  const chat = p.getByTestId("setup-chat");
  const svcs = (all) => p.evaluate(async ([id, q]) => (await fetch(`/api/v1/orgs/${id}/services${q}`)).json(), [orgId, all ? "?include_inactive=true" : ""]);
  const before = (await svcs(true)).find((s) => s.name === "Gents cut");
  await p.getByLabel("Your answer").fill("remove gents cut");
  await p.getByRole("button", { name: "Send" }).click();
  await chat.getByText(/Removed Gents cut/).last().waitFor({ timeout: 10000 });
  const hidden = await svcs(false);
  if (hidden.some((s) => s.name === "Gents cut")) throw new Error("still offered after removal");
  await p.getByLabel("Your answer").fill("undo");
  await p.getByRole("button", { name: "Send" }).click();
  await chat.getByText(/✓/).last().waitFor({ timeout: 10000 });
  await p.waitForTimeout(500);
  const after = (await svcs(false)).find((s) => s.name === "Gents cut");
  return !!after && after.id === before.id && after.price_from_pence === 2000;
});

await step("Command: real bookings and desk cases appear after they're created", async () => {
  const hours = { intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "00:00", closes_at: "23:59" })) };
  if ((await apiCall("PUT", `/orgs/${orgId}/office-hours`, hours)).status !== 200) throw new Error("hours");
  const svc = (await apiCall("POST", `/orgs/${orgId}/services`, { name: "Sports massage", duration_min: 45 })).json;
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const slot = (await apiCall("GET", `/orgs/${orgId}/availability?service_id=${svc.id}&on=${day}`)).json.slots[0];
  const b = await apiCall("POST", `/orgs/${orgId}/appointments`, { service_id: svc.id, starts_at: slot, customer_name: "Tom Okafor", customer_phone: "07700 900456" });
  if (b.status !== 201) throw new Error(`booking ${b.status}`);
  await apiCall("POST", `/orgs/${orgId}/cases`, { summary: "Wants to know if you treat sciatica", caller_name: "Jo Bloggs", assign_to_me: false });
  await p.goto(`${BASE}/command/ops`, { waitUntil: "networkidle" });
  await p.getByTestId("cmd-bookings").getByText("Tom Okafor").waitFor({ timeout: 10000 });
  await p.getByTestId("cmd-queue").getByText("Jo Bloggs").waitFor();
  return /4\/6 done/.test(await p.locator("main").innerText());
});

await step("Flow Simulate: practice receptionist answers from the workspace's real details (AI model when switched on)", async () => {
  await p.goto(`${BASE}/flow/app/simulate`, { waitUntil: "networkidle" });
  await p.getByTestId("sim-source").getByText(/real services, hours and availability/).waitFor({ timeout: 10000 });
  const ask = async (text, expect) => {
    await p.getByLabel("Caller message").fill(text);
    await p.getByRole("button", { name: "Send" }).click();
    await p.getByText(expect).last().waitFor({ timeout: 15000 });
  };
  // With an AI model switched on for the workspace (CI runs a local Claude stand-in), the call uses it;
  // otherwise the free practice brain answers.
  const brain = p.getByTestId("sim-brain");
  await brain.waitFor({ timeout: 10000 });
  if (/Brain: AI/.test(await brain.innerText())) {
    await ask("Hiya, what services do you do?", /We offer .*Gents cut/);
    // Reasoning some open models put in <think> tags must never reach the caller.
    const hidden = (await p.getByText(/The caller wants the list|<think>/).count()) === 0;
    return hidden && (await p.getByText("list_services").count()) > 0 && (await p.getByText("unsupported_answer").count()) === 0;
  }
  await ask("heyy", /Hi there!/);
  await ask("what do you know", /AI receptionist for/);
  await ask("Okay great what all services do you offer", /Gents cut \(from £20\)/);
  await ask("What's a gents cut?", /Gents cut is a 30 minutes appointment/);
  await ask("Can I book a sports massage tomorrow?", /I could do|The next one I have|is free/);
  return (await p.getByText("unsupported_answer").count()) === 0;
});

await step("Command: other screens say they still show demo data", async () => {
  await p.goto(`${BASE}/command/calls`, { waitUntil: "networkidle" });
  return (await p.getByTestId("cmd-demo-screen").count()) === 1;
});

await step("Command: 'Explore with demo data' switches to the demo, and back", async () => {
  await p.goto(`${BASE}/command/ops`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Account menu" }).click();
  await p.getByRole("menuitem", { name: "Explore with demo data" }).click();
  await p.getByText("Simulated data").waitFor({ timeout: 8000 });
  const banner = await p.getByText("You're exploring demo data.").count();
  await p.getByRole("button", { name: `Back to ${me.org}` }).first().click();
  await p.getByText(`Live · ${me.org}`).waitFor({ timeout: 8000 });
  return banner === 1;
});

await step("Atelier: the same workspace in Atelier's look, with real bookings and requests", async () => {
  await p.goto(`${BASE}/atelier/studio`, { waitUntil: "networkidle" });
  await p.getByText(/Good (morning|afternoon|evening), Nadia\./).waitFor({ timeout: 10000 });
  await p.getByText("Tom Okafor").first().waitFor();
  await p.getByTestId("atl-attention").getByText("Wants to know if you treat sciatica").waitFor();
  const summary = await p.getByTestId("atl-summary").innerText();
  return (await p.getByTestId("atl-workspace").innerText()) === me.org && /1 appointment/.test(summary) && /1 request/.test(summary);
});

await step("Atelier: other rooms say they still show demo data", async () => {
  await p.goto(`${BASE}/atelier/studio/diary`, { waitUntil: "networkidle" });
  return (await p.getByTestId("atl-demo-room").count()) === 1;
});

await step("Atelier: sign out, then sign in again in Atelier's own form", async () => {
  await p.goto(`${BASE}/atelier/studio`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Account menu" }).click();
  await p.getByRole("menuitem", { name: "Sign out" }).click();
  await p.waitForURL("**/atelier/sign-in", { timeout: 10000 });
  await p.getByLabel("Email").fill(me.email);
  await p.getByLabel("Password").fill("wrong password entirely");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("alert").waitFor({ timeout: 8000 });
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL("**/atelier/studio", { timeout: 15000 });
  await p.getByText(/Good (morning|afternoon|evening), Nadia\./).waitFor({ timeout: 10000 });
});

await step("Signed out: dashboards fall back to the labelled demo", async () => {
  await p.evaluate(() => fetch("/api/session/logout", { method: "POST", headers: { "x-voxera-csrf": "1" } }));
  await p.goto(`${BASE}/command/ops`, { waitUntil: "networkidle" });
  await p.getByText("Simulated data").waitFor({ timeout: 8000 });
  await p.goto(`${BASE}/atelier/studio`, { waitUntil: "networkidle" });
  return (await p.getByText("Demo studio").count()) > 0;
});

await step("clean-up: delete the test account and its workspace", async () => {
  await p.goto(`${BASE}/command/login`, { waitUntil: "networkidle" });
  await p.getByLabel("Email").fill(me.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL("**/command/ops", { timeout: 15000 });
  return (await apiCall("DELETE", "/me", { password: PW })).status === 204;
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} design live checks passed`);
process.exit(failed.length ? 1 : 0);
