// End-to-end test of the Flow front end against the real VOXERA API and PostgreSQL.
// Requires: API on VOXERA_API_URL (default 127.0.0.1:8000) and this app on BASE_URL.
// Usage: BASE_URL=http://localhost:3100 node scripts/e2e-live.mjs
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const owner = { name: "Ada Okafor", email: `ada-${run}@e2e.example`, org: `Halden & Rye ${run}` };
const colleague = { name: "Mia Castell", email: `mia-${run}@e2e.example`, org: `Mia Home ${run}` };
const outsider = { name: "Olu Stranger", email: `olu-${run}@e2e.example`, org: `Elsewhere ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const step = async (name, fn) => { try { const r = await fn(); check(name, r !== false); } catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 220)); } };

const browser = await chromium.launch();
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page errors", false, e.message));
  return { ctx, page };
};

async function signUp(page, u) {
  await page.goto(`${BASE}/flow/enter?mode=signup`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Business name").fill(u.org);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Create workspace", exact: true }).last().click();
  await page.waitForURL("**/flow/app", { timeout: 15000 });
  await page.getByRole("button", { name: "Workspace menu" }).waitFor();
}

const status = (page, text) => page.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: 8000 });

// ---------- owner ----------
const A = await newPage();
const p = A.page;
let orgId = "";

await step("sign up creates a workspace and signs in", async () => {
  await signUp(p, owner);
  return (await p.getByRole("button", { name: "Workspace menu" }).innerText()).includes(owner.org);
});

await step("session tokens are httpOnly (not readable by page scripts)", async () => {
  const cookies = await p.evaluate(() => document.cookie);
  const all = await A.ctx.cookies();
  return !cookies.includes("vx_at") && !cookies.includes("vx_rt") && all.some((c) => c.name === "vx_at" && c.httpOnly) && all.some((c) => c.name === "vx_rt" && c.httpOnly);
});

await step("mutations without the CSRF header are rejected", async () => {
  const r = await p.evaluate(async () => (await fetch("/api/v1/orgs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "csrf" }) })).status);
  return r === 403;
});

await step("business profile saves and persists after reload", async () => {
  orgId = await p.evaluate(async () => (await (await fetch("/api/v1/me/organizations")).json())[0].organization.id);
  await p.goto(`${BASE}/flow/app/workspace`, { waitUntil: "networkidle" });
  await p.getByLabel("Town / city").fill("Bristol");
  await p.getByLabel("Website (https://…)").fill("https://halden.example");
  await p.getByRole("button", { name: "Save profile" }).click();
  await status(p, "Profile saved");
  await p.reload({ waitUntil: "networkidle" });
  return (await p.getByLabel("Town / city").inputValue()) === "Bristol";
});

await step("API validation errors are shown (non-https website)", async () => {
  await p.getByLabel("Website (https://…)").fill("http://insecure.example");
  await p.getByRole("button", { name: "Save profile" }).click();
  await p.getByRole("alert").filter({ hasText: "website" }).waitFor({ timeout: 8000 });
  await p.getByLabel("Website (https://…)").fill("https://halden.example");
});

await step("opening hours save; invalid times are rejected", async () => {
  await p.getByRole("tab", { name: "Opening hours" }).click();
  await p.getByRole("button", { name: "Add hours for Tuesday" }).click();
  await p.getByRole("button", { name: "Add hours for Saturday" }).click();
  await p.getByLabel("Saturday closes").fill("13:00");
  await p.getByRole("button", { name: "Save hours" }).click();
  await status(p, "Opening hours saved");
  await p.getByLabel("Saturday opens").fill("15:00");
  await p.getByRole("button", { name: "Save hours" }).click();
  await p.getByRole("alert").first().waitFor({ timeout: 8000 });
  await p.getByLabel("Saturday opens").fill("09:00");
  await p.getByRole("button", { name: "Save hours" }).click();
  await status(p, "Opening hours saved");
});

await step("services: add, list, reject duplicate name", async () => {
  await p.getByRole("tab", { name: "Services" }).click();
  await p.getByLabel("Name").fill("Balayage");
  await p.getByLabel("Minutes").fill("180");
  await p.getByLabel("From £").fill("165");
  await p.getByRole("button", { name: "Add service" }).click();
  await p.getByText("from £165.00").waitFor({ timeout: 8000 });
  await p.getByLabel("Name").fill("balayage");
  await p.getByRole("button", { name: "Add service" }).click();
  await p.getByRole("alert").filter({ hasText: "already exists" }).waitFor({ timeout: 8000 });
});

await step("workspace settings save", async () => {
  await p.getByRole("tab", { name: "Settings" }).click();
  await p.getByLabel("Keep recordings & transcripts (days, 7–365)").fill("30");
  await p.getByRole("button", { name: "Save settings" }).click();
  await status(p, "Settings saved");
});

await step("agent draft saves to the workspace", async () => {
  await p.goto(`${BASE}/flow/app/agent`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Save current draft as an agent" }).click();
  await status(p, "Saved");
  await p.getByText(/saved \d/).first().waitFor({ timeout: 8000 });
});

await step("voice lab test call saves measured metrics to the workspace", async () => {
  await p.goto(`${BASE}/flow/app/voice`, { waitUntil: "networkidle" });
  const mic = p.getByRole("switch", { name: "Use microphone" });
  if ((await mic.getAttribute("aria-checked")) === "true") await mic.click();
  await p.getByRole("button", { name: "Start call" }).click();
  await p.waitForFunction(() => /\d+ ms/.test(document.querySelector('[data-testid="ttfa"]')?.textContent ?? ""), null, { timeout: 15000 });
  await p.getByRole("button", { name: "End call" }).click();
  await p.getByRole("button", { name: "Save" }).click();
  await status(p, "Saved to workspace");
  await p.getByTestId("voice-history").locator("tbody tr").first().waitFor({ timeout: 8000 });
});

let inviteLink = "";
await step("invite a colleague (development link shown)", async () => {
  await p.goto(`${BASE}/flow/app/team`, { waitUntil: "networkidle" });
  await p.getByLabel("Invite email").fill(colleague.email);
  await p.getByLabel("Invite role").selectOption("manager");
  await p.getByRole("button", { name: "Invite" }).click();
  inviteLink = await p.getByTestId("invite-link").innerText({ timeout: 8000 });
  return inviteLink.includes("/flow/invite?token=");
});

await step("audit log shows the owner's actions", async () => {
  await p.reload({ waitUntil: "networkidle" });
  const text = await p.locator("table").last().innerText();
  return ["organization.created", "business_profile.updated", "office_hours.replaced", "service.created", "settings.updated", "agent.created", "voice_session.saved", "invitation.created"].every((a) => text.includes(a));
});

await step("usage: simulated minute recorded separately from billable", async () => {
  await p.goto(`${BASE}/flow/app/usage`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Record a simulated test minute" }).click();
  await status(p, "Recorded 1 simulated minute");
  return (await p.getByTestId("sim-call_minutes").innerText()) !== "0" && (await p.getByTestId("live-call_minutes").innerText()) === "0";
});

await step("demo-backed pages are labelled as demo data when signed in", async () => {
  await p.goto(`${BASE}/flow/app/calls`, { waitUntil: "networkidle" });
  return (await p.getByText("still shows demo data").count()) === 1;
});

await step("workspace export downloads JSON without secrets", async () => {
  await p.goto(`${BASE}/flow/app/workspace`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: "Data & privacy" }).click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export workspace" }).click()]);
  const data = fs.readFileSync(await dl.path(), "utf8");
  const j = JSON.parse(data);
  return j.services[0].name === "Balayage" && !data.includes("password_hash") && !data.includes("token_hash");
});

// ---------- colleague accepts the invitation ----------
const B = await newPage();
await step("colleague accepts the invitation and gets the manager role", async () => {
  await signUp(B.page, colleague);
  await B.page.goto(inviteLink, { waitUntil: "networkidle" });
  await B.page.getByRole("button", { name: "Accept invitation" }).click();
  await B.page.waitForURL("**/flow/app/workspace", { timeout: 15000 });
  const menu = await B.page.getByRole("button", { name: "Workspace menu" }).innerText();
  return menu.includes(owner.org) && menu.includes("manager");
});

await step("manager sees business settings read-only", async () => {
  await B.page.getByText("can view these settings but not change them").waitFor({ timeout: 8000 });
  return (await B.page.getByRole("button", { name: "Save profile" }).count()) === 0;
});

await step("an invitation link cannot be used twice", async () => {
  const C = await newPage();
  await signUp(C.page, outsider);
  await C.page.goto(inviteLink, { waitUntil: "networkidle" });
  await C.page.getByRole("button", { name: "Accept invitation" }).click();
  await C.page.getByRole("alert").waitFor({ timeout: 8000 });
  // ...and the outsider cannot read the owner's workspace through the proxy.
  const code = await C.page.evaluate(async (id) => (await fetch(`/api/v1/orgs/${id}/services`)).status, orgId);
  await C.page.evaluate(async (pw) => fetch("/api/v1/me", { method: "DELETE", headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: JSON.stringify({ password: pw }) }), PW);
  await C.ctx.close();
  return code === 404;
});

await step("sign out ends the session", async () => {
  await p.getByRole("button", { name: "Workspace menu" }).click();
  await p.getByRole("menuitem", { name: "Sign out" }).click();
  await p.waitForURL("**/flow/enter", { timeout: 10000 });
  return (await p.evaluate(async () => (await (await fetch("/api/session/me")).json()).user)) === null;
});

await step("sign in again restores the workspace", async () => {
  await p.getByLabel("Email").fill(owner.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await p.waitForURL("**/flow/app", { timeout: 15000 });
  return (await p.getByRole("button", { name: "Workspace menu" }).innerText()).includes(owner.org);
});

await step("owner deletes the workspace; colleague loses access", async () => {
  await p.goto(`${BASE}/flow/app/workspace`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: "Data & privacy" }).click();
  await p.getByLabel("Confirm workspace name").fill(owner.org);
  await p.getByRole("button", { name: "Delete workspace" }).click();
  await p.waitForURL("**/flow/app", { timeout: 15000 });
  const code = await B.page.evaluate(async (id) => (await fetch(`/api/v1/orgs/${id}`)).status, orgId);
  return code === 404;
});

await step("accounts can be deleted (clean-up)", async () => {
  for (const [page, u] of [[p, owner], [B.page, colleague]]) {
    await page.goto(`${BASE}/flow/app/workspace`, { waitUntil: "networkidle" });
    if (await page.getByRole("tab", { name: "Data & privacy" }).count()) await page.getByRole("tab", { name: "Data & privacy" }).click();
    await page.getByLabel("Your password").fill(PW);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL("**/flow", { timeout: 15000 });
  }
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);
