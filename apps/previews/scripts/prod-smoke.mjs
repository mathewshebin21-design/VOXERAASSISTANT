// One-off production smoke test for the PR #21 release (authorised by the owner).
// Creates ONE temporary probe account + workspace through the production web app, checks
// authentication, the design endpoints and the new frontend behaviour, then deletes both and
// proves they are gone. Prints no credentials or tokens.
// Usage: node scripts/prod-smoke.mjs <expected-short-sha>
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// SMOKE_API / SMOKE_WEB exist only to dry-run this script against a local stack.
const API = process.env.SMOKE_API ?? "https://voxera-api-two.vercel.app";
const WEB = process.env.SMOKE_WEB ?? "https://voxera-flow.vercel.app";
const sha = process.argv[2];
assert.match(sha ?? "", /^[a-f0-9]{7}$/, "short sha required");

const results = [];
const gate = async (name, fn) => {
  try { const r = await fn(); const ok = r === true || r === undefined; results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — ${r}`}`); return ok; }
  catch (e) { results.push(false); console.log(`FAIL  ${name}  — ${String(e).split("\n")[0].slice(0, 200)}`); return false; }
};
const call = (url, init = {}) => fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000), ...init });
const json = (extra = {}) => ({ "content-type": "application/json", ...extra });

const run = Date.now().toString(36);
const probe = { email: `prod-smoke-${run}@isolation.example`, password: `probe ${run} release smoke`, org: `Release Probe ${run}` };
let token = "";
let orgId = "";
let created = false;

await gate("API /healthz serves the merge commit", async () => {
  const h = await (await call(`${API}/healthz`)).json();
  return h.commit === sha || `commit ${h.commit}`;
});
await gate("API /readyz returns 200 (production database reachable)", async () => {
  const r = await call(`${API}/readyz`);
  return r.status === 200 || `status ${r.status}`;
});
await gate("web serves / and /start", async () => {
  const a = await call(`${WEB}/`); const b = await call(`${WEB}/start`);
  return (a.status === 200 && b.status === 200) || `${a.status}/${b.status}`;
});

try {
  await gate("sign-up through the production web app creates the probe account and workspace", async () => {
    const r = await call(`${WEB}/api/session/signup`, {
      method: "POST", headers: json({ "x-voxera-csrf": "1" }),
      body: JSON.stringify({ email: probe.email, password: probe.password, full_name: "Release Probe", organization_name: probe.org }),
    });
    created = r.ok;
    return r.ok || `status ${r.status}`;
  });
  await gate("wrong password is refused (401)", async () => {
    const r = await call(`${API}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify({ email: probe.email, password: "wrong password entirely" }) });
    return r.status === 401 || `status ${r.status}`;
  });
  await gate("sign-in at the production API succeeds and /me is the probe", async () => {
    const r = await call(`${API}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify({ email: probe.email, password: probe.password }) });
    if (r.status !== 200) return `login ${r.status}`;
    token = (await r.json()).access_token;
    const me = await (await call(`${API}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json();
    return me.email === probe.email || "wrong user";
  });
  const auth = () => json({ authorization: `Bearer ${token}` });
  await gate("the probe sees exactly its own workspace", async () => {
    const orgs = await (await call(`${API}/v1/me/organizations`, { headers: auth() })).json();
    orgId = orgs[0]?.organization.id ?? "";
    return (orgs.length === 1 && orgs[0].organization.name === probe.org && orgs[0].role === "owner") || `orgs ${orgs.length}`;
  });
  await gate("design endpoints: read, choose Flow for me, and it persists", async () => {
    const d0 = await call(`${API}/v1/orgs/${orgId}/design`, { headers: auth() });
    if (d0.status !== 200) return `read ${d0.status}`;
    const put = await call(`${API}/v1/orgs/${orgId}/design/me`, { method: "PUT", headers: auth(), body: JSON.stringify({ design: "flow" }) });
    if (put.status !== 200) return `put ${put.status}`;
    const d1 = await (await call(`${API}/v1/orgs/${orgId}/design`, { headers: auth() })).json();
    return (d1.effective === "flow" && d1.my_override === "flow") || `effective ${d1.effective}`;
  });

  // Browser checks of the newly deployed frontend.
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    await gate("signed out, the chooser says so and offers sign-in back to it (new in this release)", async () => {
      const p = await (await browser.newContext()).newPage();
      await p.goto(`${WEB}/start/design`, { waitUntil: "networkidle" });
      await p.getByTestId("design-signed-out").waitFor({ timeout: 15000 });
      const href = await p.getByTestId("design-signin").getAttribute("href");
      await p.context().close();
      return href === "/start?next=%2Fstart%2Fdesign" || `href ${href}`;
    });
    await gate("signing in on /start opens the chosen design (Flow) with the real workspace name", async () => {
      const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await p.goto(`${WEB}/start`, { waitUntil: "networkidle" });
      await p.getByLabel("Email").fill(probe.email);
      await p.getByLabel("Password").fill(probe.password);
      await p.getByRole("button", { name: "Sign in", exact: true }).last().click();
      await p.waitForURL("**/flow/app", { timeout: 20000 });
      await p.waitForLoadState("networkidle");
      const crumb = await p.getByTestId("flw-crumb").innerText();
      const gateShown = await p.getByTestId("workspace-unavailable").count();
      await p.goto(`${WEB}/start/design`, { waitUntil: "networkidle" });
      await p.getByRole("heading", { name: "Switch design" }).waitFor({ timeout: 15000 });
      const signedOut = await p.getByTestId("design-signed-out").count();
      await p.context().close();
      return (crumb === probe.org && gateShown === 0 && signedOut === 0) || `crumb "${crumb}", gate ${gateShown}, signedOut ${signedOut}`;
    });
  } finally {
    await browser.close();
  }
} finally {
  // Clean-up always runs once the probe exists, then is proven.
  if (created) {
    if (!token) {
      const r = await call(`${API}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify({ email: probe.email, password: probe.password }) });
      if (r.status === 200) token = (await r.json()).access_token;
    }
    await gate("clean-up: the probe account and its workspace are deleted (204)", async () => {
      const r = await call(`${API}/v1/me`, { method: "DELETE", headers: json({ authorization: `Bearer ${token}` }), body: JSON.stringify({ password: probe.password }) });
      return r.status === 204 || `status ${r.status}`;
    });
    await gate("clean-up proof: the probe can no longer sign in (401)", async () => {
      const r = await call(`${API}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify({ email: probe.email, password: probe.password }) });
      return r.status === 401 || `status ${r.status}`;
    });
    await gate("clean-up proof: the old session no longer reaches the workspace (401)", async () => {
      if (!orgId) return "no workspace id recorded";
      const r = await call(`${API}/v1/orgs/${orgId}/design`, { headers: { authorization: `Bearer ${token}` } });
      return r.status === 401 || `status ${r.status}`;
    });
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} production smoke checks passed`);
process.exit(failed ? 1 : 0);
