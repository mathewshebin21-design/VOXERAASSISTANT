// Black-box isolation gate for a feature branch's own Vercel previews (generalises the PR #20
// gate). Reads no secrets and prints no hosts or credentials. It proves, through behaviour:
//   1. the branch API serves this commit and its database answers;
//   2. an account created through the branch web app can sign in at the branch API
//      (so the web app forwards to that API, not to staging or production);
//   3. the same credentials are refused by shared staging AND by production (so the branch
//      database is neither; a refused sign-in writes nothing there);
//   4. the design endpoints answer on that account's workspace;
//   5. the probe account is deleted again.
// Only preview origins derived from the branch name are accepted; the production, staging and
// RC-1 branches are refused outright.
// Usage: node scripts/branch-isolation.mjs <branch> <full-sha>
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const STAGING_API = "https://voxera-api-git-staging-ai-e399.vercel.app";
export const PRODUCTION_API = "https://voxera-api-two.vercel.app";
const PROTECTED = new Set(["claude/confident-shannon-7nb05f", "staging", "codex/rc1-validation", "main"]);

/** Vercel's per-branch preview origins for a branch name. */
export function previewOrigins(branch) {
  assert.ok(typeof branch === "string" && /^[A-Za-z0-9._/-]{1,80}$/.test(branch), "Invalid branch name");
  assert.ok(!PROTECTED.has(branch), `Refusing protected branch ${branch}`);
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const api = `https://voxera-api-git-${slug}-ai-e399.vercel.app`;
  const web = `https://voxera-flow-git-${slug}-ai-e399.vercel.app`;
  // Vercel shortens hostnames over 63 characters; fail rather than guess.
  const label = (u) => new URL(u).hostname.split(".")[0].length;
  assert.ok(label(api) <= 63 && label(web) <= 63, "Branch name too long for a stable preview hostname");
  return { api, web };
}

export async function verifyBranch(branch, sha, request = fetch) {
  const { api, web } = previewOrigins(branch);
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");

  const call = (url, init = {}) =>
    request(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  const json = (body) => ({ "content-type": "application/json", ...body });

  const health = await (await call(`${api}/healthz`)).json();
  assert.equal(health.commit, sha.slice(0, 7), "Branch API is not serving this commit");
  assert.equal((await call(`${api}/readyz`)).status, 200, "Branch API database is not ready");

  const run = Date.now().toString(36);
  const creds = { email: `branch-probe-${run}@isolation.example`, password: `probe ${run} horse battery` };
  const signup = await call(`${web}/api/session/signup`, {
    method: "POST",
    headers: json({ "x-voxera-csrf": "1" }),
    body: JSON.stringify({ ...creds, full_name: "Isolation Probe", organization_name: `Probe ${run}` }),
  });
  assert.ok(signup.ok, `Sign-up through the branch web app failed (${signup.status})`);

  const login = await call(`${api}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify(creds) });
  assert.equal(login.status, 200, "Account created through the web app is unknown to the branch API: web routes elsewhere");
  const { access_token: token } = await login.json();
  const auth = json({ authorization: `Bearer ${token}` });
  try {
    for (const [name, other] of [["shared staging", STAGING_API], ["production", PRODUCTION_API]]) {
      const r = await call(`${other}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify(creds) });
      assert.equal(r.status, 401, `${name} accepted the branch account (${r.status}): databases are not separate`);
    }
    const orgs = await (await call(`${api}/v1/me/organizations`, { headers: auth })).json();
    const design = await call(`${api}/v1/orgs/${orgs[0].organization.id}/design`, { headers: auth });
    assert.equal(design.status, 200, "Design endpoints do not answer");
  } finally {
    const del = await call(`${api}/v1/me`, { method: "DELETE", headers: auth, body: JSON.stringify({ password: creds.password }) });
    assert.equal(del.status, 204, "Probe account clean-up failed");
  }
  return { api, web };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [branch, sha] = process.argv.slice(2);
  await verifyBranch(branch, sha);
  console.log("Verified: branch API serves this commit; web routes to it; its database is separate from staging and production; design endpoints live; probe removed.");
}
