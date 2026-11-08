// Design selection against the real VOXERA API: one entry point, the chooser, owner default vs
// member override, persistence, switching from every shell, and honest demo labels.
// Usage: BASE_URL=http://localhost:3000 node scripts/e2e-design-select.mjs
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const run = Date.now().toString(36);
const PW = "correct horse battery staple";
const owner = { name: "Priya Shah", email: `owner-${run}@design.example`, org: `Shah Clinic ${run}` };
const staff = { name: "Tom Reid", email: `staff-${run}@design.example`, org: `Reid Own ${run}` };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const step = async (name, fn) => { try { const r = await fn(); check(name, r !== false && typeof r !== "string", typeof r === "string" ? r : ""); } catch (e) { check(name, false, String(e).split("\n")[0].slice(0, 220)); } };

const browser = await chromium.launch();
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const p of [a, b]) p.on("pageerror", (e) => check("no page errors", false, e.message));
const call = (p, method, path, body) => p.evaluate(async ([m, u, x]) => {
  const r = await fetch(`/api/v1${u}`, { method: m, headers: { "content-type": "application/json", "x-voxera-csrf": "1" }, body: x ? JSON.stringify(x) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, path, body]);
let orgId = "";

async function createWorkspace(p, who) {
  await p.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: "Create workspace" }).click();
  await p.getByLabel("Your name").fill(who.name);
  await p.getByLabel("Business name").fill(who.org);
  await p.getByLabel("Email").fill(who.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Create workspace", exact: true }).last().click();
}

await step("home page links to the single entry point", async () => {
  await a.goto(BASE, { waitUntil: "networkidle" });
  return (await a.getByTestId("start-link").getAttribute("href")) === "/start";
});

await step("new workspace is asked to choose a design; Atelier is recommended", async () => {
  await createWorkspace(a, owner);
  await a.waitForURL("**/start/design?new=1", { timeout: 15000 });
  await a.getByRole("heading", { name: "Choose how VOXERA looks" }).waitFor({ timeout: 10000 });
  const atelier = a.getByTestId("design-atelier");
  return (await atelier.getByText("Recommended for small businesses").count()) === 1
    && (await atelier.getByText("Workspace default").count()) === 1
    && (await a.getByRole("button", { name: "Use for everyone" }).count()) === 2; // owner sees it on the other two
});

await step("owner sets Command for everyone and lands in Command with the real workspace", async () => {
  await a.getByTestId("design-command").getByRole("button", { name: "Use for everyone" }).click();
  await a.waitForURL("**/command/ops", { timeout: 15000 });
  await a.getByTestId("cmd-workspace").waitFor({ timeout: 10000 });
  orgId = (await call(a, "GET", "/me/organizations")).json[0].organization.id;
  return (await a.getByTestId("cmd-workspace").innerText()) === owner.org;
});

await step("the choice persists: /start opens Command again after a reload", async () => {
  await a.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  await a.waitForURL("**/command/ops", { timeout: 15000 });
  const d = (await call(a, "GET", `/orgs/${orgId}/design`)).json;
  return d.workspace_default === "command" && d.effective === "command" && d.my_override === null;
});

await step("Command's account menu offers Switch design", async () => {
  await a.getByRole("button", { name: "Account menu" }).click();
  await a.getByTestId("switch-design").click();
  await a.waitForURL("**/start/design", { timeout: 10000 });
  await a.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 10000 });
  return (await a.getByTestId("design-command").getByText("Workspace default").count()) === 1;
});

await step("owner picks Flow just for themselves: Flow opens, the workspace default stays Command", async () => {
  await a.getByTestId("design-flow").getByRole("button", { name: "Use just for me" }).click();
  await a.waitForURL("**/flow/app", { timeout: 15000 });
  const d = (await call(a, "GET", `/orgs/${orgId}/design`)).json;
  return d.workspace_default === "command" && d.my_override === "flow" && d.effective === "flow";
});

await step("switching design keeps workspace data (same services and members via the API)", async () => {
  const svc = await call(a, "POST", `/orgs/${orgId}/services`, { name: "Consultation", duration_min: 30 });
  const before = (await call(a, "GET", `/orgs/${orgId}/services`)).json.map((s) => s.id).sort().join();
  await call(a, "PUT", `/orgs/${orgId}/design/me`, { design: "atelier" });
  const after = (await call(a, "GET", `/orgs/${orgId}/services`)).json.map((s) => s.id).sort().join();
  await call(a, "PUT", `/orgs/${orgId}/design/me`, { design: "flow" });
  return svc.status === 201 && before === after && before.includes(svc.json.id);
});

await step("a staff member joins and opens the workspace default (Command), not the owner's Flow", async () => {
  await createWorkspace(b, staff);
  await b.waitForURL("**/start/design?new=1", { timeout: 15000 });
  const inv = await call(a, "POST", `/orgs/${orgId}/invitations`, { email: staff.email, role: "staff" });
  const acc = await call(b, "POST", "/invitations/accept", { token: inv.json.token });
  if (acc.status !== 200) return `accept ${acc.status}`;
  await b.evaluate((id) => localStorage.setItem("voxera-active-org", id), orgId);
  await b.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  await b.waitForURL("**/command/ops", { timeout: 15000 });
  return (await b.getByTestId("cmd-workspace").innerText()) === owner.org;
});

await step("staff cannot change the workspace default (no button, API 403)", async () => {
  await b.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await b.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 10000 });
  const noButton = (await b.getByRole("button", { name: "Use for everyone" }).count()) === 0;
  const api = await call(b, "PUT", `/orgs/${orgId}/design/default`, { design: "flow" });
  return noButton && api.status === 403;
});

await step("staff picks Atelier just for themselves; nobody else's view changes", async () => {
  await b.getByTestId("design-atelier").getByRole("button", { name: "Use just for me" }).click();
  await b.waitForURL("**/atelier/studio", { timeout: 15000 });
  const mine = (await call(b, "GET", `/orgs/${orgId}/design`)).json;
  const theirs = (await call(a, "GET", `/orgs/${orgId}/design`)).json;
  return mine.effective === "atelier" && theirs.effective === "flow" && theirs.workspace_default === "command";
});

await step("Atelier's account menu offers Switch design", async () => {
  await b.getByRole("button", { name: "Account menu" }).click();
  return (await b.getByTestId("switch-design").getAttribute("href")) === "/start/design";
});

await step("Flow's account menu offers Switch design", async () => {
  await a.goto(`${BASE}/flow/app`, { waitUntil: "networkidle" });
  await a.getByRole("button", { name: "Workspace menu" }).click();
  return (await a.getByTestId("switch-design").getAttribute("href")) === "/start/design";
});

await step("staff follows the workspace default again", async () => {
  await b.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await b.getByRole("button", { name: /Follow the workspace default/ }).click();
  await b.waitForURL("**/command/ops", { timeout: 15000 });
  return (await call(b, "GET", `/orgs/${orgId}/design`)).json.my_override === null;
});

await step("screens without real data stay labelled as demo in every design", async () => {
  await b.goto(`${BASE}/command/calls`, { waitUntil: "networkidle" });
  const cmd = await b.getByTestId("cmd-demo-screen").count();
  await b.goto(`${BASE}/atelier/studio/diary`, { waitUntil: "networkidle" });
  const atl = await b.getByTestId("atl-demo-room").count();
  await b.goto(`${BASE}/flow/app/calls`, { waitUntil: "networkidle" });
  const flw = await b.getByText("still shows demo data").count();
  return cmd === 1 && atl === 1 && flw >= 1 ? true : `command ${cmd}, atelier ${atl}, flow ${flw}`;
});

// Authenticated navigation (regression for a production report: the chooser said "Sign in first"
// while another page looked signed in). Each case uses a fresh browser context.
const fresh = async () => (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await step("a demo dashboard is not a session: the chooser says so and offers sign-in", async () => {
  const p = await fresh();
  await p.goto(`${BASE}/command/ops`, { waitUntil: "networkidle" });
  await p.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await p.getByTestId("design-signed-out").waitFor({ timeout: 10000 });
  const href = await p.getByTestId("design-signin").getAttribute("href");
  await p.context().close();
  return href === "/start?next=%2Fstart%2Fdesign" ? true : `href ${href}`;
});

await step("signing in from the chooser's prompt returns to the chooser", async () => {
  const p = await fresh();
  await p.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await p.getByTestId("design-signin").click();
  await p.waitForURL("**/start?next=*", { timeout: 10000 });
  await p.getByLabel("Email").fill(owner.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await p.waitForURL("**/start/design", { timeout: 15000 });
  await p.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 10000 });
  await p.context().close();
  return true;
});

await step("signed in on Command's own sign-in page, the chooser opens with no second sign-in", async () => {
  const p = await fresh();
  await p.goto(`${BASE}/command/login`, { waitUntil: "networkidle" });
  await p.locator("#cmd-email").fill(owner.email);
  await p.locator("#cmd-pw").fill(PW);
  await p.locator("#cmd-pw").press("Enter");
  await p.waitForURL("**/command/ops", { timeout: 15000 });
  await p.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await p.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 10000 });
  const wrong = await p.getByTestId("design-signed-out").count();
  await p.context().close();
  return wrong === 0;
});

await step("an unsafe ?next= is ignored: sign-in opens the workspace's own design", async () => {
  const p = await fresh();
  await p.goto(`${BASE}/start?next=${encodeURIComponent("https://evil.example/")}`, { waitUntil: "networkidle" });
  await p.getByLabel("Email").fill(owner.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await p.waitForURL("**/flow/app", { timeout: 15000 }); // the owner's own override is Flow
  await p.context().close();
  return true;
});

await step("if the workspace list fails, the chooser says so and recovers on retry", async () => {
  const p = await fresh();
  await p.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  await p.getByLabel("Email").fill(owner.email);
  await p.getByLabel("Password").fill(PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await p.waitForURL("**/flow/app", { timeout: 15000 });
  await p.route("**/api/v1/me/organizations", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service unavailable"}' }));
  await p.goto(`${BASE}/start/design`, { waitUntil: "networkidle" });
  await p.getByTestId("design-orgs-error").waitFor({ timeout: 10000 });
  const signedOutShown = await p.getByTestId("design-signed-out").count();
  await p.unroute("**/api/v1/me/organizations");
  await p.getByRole("button", { name: "Try again" }).click();
  await p.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 10000 });
  await p.context().close();
  return signedOutShown === 0;
});

// Each of the three designs, once selected, must survive a reload and a full re-authentication
// (a fresh browser context with no cookies or local storage, signing in again). A dedicated
// account keeps its three sign-ins under the API's per-account limit of five a minute.
const landed = (p, path) => p.waitForURL(`**${path}`, { timeout: 15000 }).then(() => true, () => false);
const HOME = { command: "/command/ops", atelier: "/atelier/studio", flow: "/flow/app" };
const member = { name: "Ana Ruiz", email: `persist-${run}@design.example`, org: `Ruiz Studio ${run}` };
const m = await fresh();
let memberOrg = "";
await step("a third account creates its own workspace for the persistence checks", async () => {
  await createWorkspace(m, member);
  await m.waitForURL("**/start/design?new=1", { timeout: 15000 });
  memberOrg = (await call(m, "GET", "/me/organizations")).json[0].organization.id;
  return Boolean(memberOrg);
});
for (const design of ["command", "atelier", "flow"]) {
  await step(`${design} persists after a reload and after signing in again`, async () => {
    const set = await call(m, "PUT", `/orgs/${memberOrg}/design/me`, { design });
    if (set.status !== 200) return `select ${set.status}`;
    await m.goto(`${BASE}/start`, { waitUntil: "networkidle" });
    await m.reload({ waitUntil: "networkidle" });
    if (!(await landed(m, HOME[design]))) return `after reload: ${new URL(m.url()).pathname}`;
    const p = await fresh();
    try {
      await p.goto(`${BASE}/start`, { waitUntil: "networkidle" });
      await p.getByLabel("Email").fill(member.email);
      await p.getByLabel("Password").fill(PW);
      await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
      if (!(await landed(p, HOME[design]))) return `after signing in again: ${new URL(p.url()).pathname}`;
      const d = (await call(p, "GET", `/orgs/${memberOrg}/design`)).json;
      return d.effective === design && d.my_override === design ? true : `effective ${d.effective}`;
    } finally {
      await p.context().close();
    }
  });
}

// When a signed-in user's workspace list fails, no dashboard may fall back to demo data: each
// design shows that the workspace is unavailable, recovers on retry, and offers demo data only
// as an explicit choice.
const DEMO_NAME = "Halden & Rye";
const ORGS = "**/api/v1/me/organizations";
const fail503 = (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service unavailable"}' });
for (const design of ["command", "atelier", "flow"]) {
  await step(`${design}: a failed workspace list shows an error, never demo data, and recovers on retry`, async () => {
    await m.route(ORGS, fail503);
    await m.goto(`${BASE}${HOME[design]}`, { waitUntil: "networkidle" });
    try {
      await m.getByTestId("workspace-unavailable").waitFor({ timeout: 10000 });
    } finally {
      await m.unroute(ORGS);
    }
    const body = await m.locator("body").innerText();
    if (body.includes(DEMO_NAME)) return "demo data shown";
    if (!body.includes("Service unavailable")) return "error detail missing";
    await m.getByRole("button", { name: "Try again" }).click();
    await m.getByTestId("workspace-unavailable").waitFor({ state: "detached", timeout: 10000 });
    await m.waitForLoadState("networkidle");
    const after = await m.locator("body").innerText();
    return after.includes(member.org) && !after.includes(DEMO_NAME) ? true : "workspace not shown after retry";
  });
}

await step("from the error, demo data opens only when chosen, labelled as demo", async () => {
  await m.route(ORGS, fail503);
  await m.goto(`${BASE}/command/ops`, { waitUntil: "networkidle" });
  try {
    await m.getByTestId("workspace-unavailable").waitFor({ timeout: 10000 });
    await m.getByRole("button", { name: "Explore demo data instead" }).click();
    await m.getByTestId("workspace-unavailable").waitFor({ state: "detached", timeout: 10000 });
  } finally {
    await m.unroute(ORGS);
  }
  const labelled = (await m.getByText("Simulation mode").count()) > 0 && (await m.getByTestId("cmd-workspace").innerText()) === DEMO_NAME;
  await m.evaluate(() => localStorage.removeItem("voxera-view-demo"));
  return labelled;
});

await step("a signed-in user with no workspace is offered to create one, never shown demo data", async () => {
  const del = await call(m, "DELETE", `/orgs/${memberOrg}`, { confirm_name: member.org });
  if (del.status !== 204) return `delete workspace ${del.status}`;
  await m.goto(`${BASE}/atelier/studio`, { waitUntil: "networkidle" });
  await m.getByTestId("workspace-none").waitFor({ timeout: 10000 });
  if ((await m.locator("body").innerText()).includes(DEMO_NAME)) return "demo data shown";
  const fresh = `Ruiz Again ${run}`;
  await m.getByLabel("Business name").fill(fresh);
  await m.getByRole("button", { name: "Create workspace" }).click();
  await m.getByTestId("workspace-none").waitFor({ state: "detached", timeout: 10000 });
  await m.waitForLoadState("networkidle");
  const orgs = (await call(m, "GET", "/me/organizations")).json ?? [];
  return orgs.length === 1 && orgs[0].organization.name === fresh ? true : `workspaces ${orgs.length}`;
});

await step("clean-up: delete all test accounts and their workspaces", async () => {
  const s = await call(b, "DELETE", "/me", { password: PW });
  const o = await call(a, "DELETE", "/me", { password: PW });
  const r = memberOrg ? (await call(m, "DELETE", "/me", { password: PW })).status : 204;
  return s.status === 204 && o.status === 204 && r === 204 ? true : `deleted ${s.status}/${o.status}/${r}`;
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} design selection checks passed`);
process.exit(failed.length ? 1 : 0);
