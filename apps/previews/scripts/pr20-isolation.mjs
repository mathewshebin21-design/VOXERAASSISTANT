// Black-box isolation gate for the PR #20 previews. Reads no secrets and prints no hosts or
// credentials; it proves routing and database separation through behaviour:
//   1. the PR #20 API serves this commit and its database answers;
//   2. an account created through the PR #20 web app can sign in at the PR #20 API
//      (so the web app forwards to that API, not to staging or production);
//   3. the same credentials are refused by the shared staging API (so the PR #20 database
//      is not the staging database; a refused sign-in writes nothing there);
//   4. the design endpoints from migration 0009 answer on that account's workspace;
//   5. the probe account is deleted again.
// Usage: node scripts/pr20-isolation.mjs <api-origin> <web-origin> <full-sha>
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const PR20_API = "https://voxera-api-git-claude-design-selection-ai-e399.vercel.app";
export const PR20_WEB = "https://voxera-flow-git-claude-design-selection-ai-e399.vercel.app";
export const STAGING_API = "https://voxera-api-git-staging-ai-e399.vercel.app";

export async function verifyPr20(api, web, sha, request = fetch) {
  assert.equal(api, PR20_API, "Unexpected PR #20 API origin");
  assert.equal(web, PR20_WEB, "Unexpected PR #20 web origin");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");

  const call = (url, init = {}) =>
    request(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  const json = (body) => ({ "content-type": "application/json", ...body });

  const health = await (await call(`${api}/healthz`)).json();
  assert.equal(health.commit, sha.slice(0, 7), "PR #20 API is not serving this commit");
  assert.equal((await call(`${api}/readyz`)).status, 200, "PR #20 API database is not ready");

  const run = Date.now().toString(36);
  const creds = { email: `pr20-probe-${run}@isolation.example`, password: `probe ${run} horse battery` };
  const signup = await call(`${web}/api/session/signup`, {
    method: "POST",
    headers: json({ "x-voxera-csrf": "1" }),
    body: JSON.stringify({ ...creds, full_name: "Isolation Probe", organization_name: `Probe ${run}` }),
  });
  assert.ok(signup.ok, `Sign-up through the PR #20 web app failed (${signup.status})`);

  const login = await call(`${api}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify(creds) });
  assert.equal(login.status, 200, "Account created through the web app is unknown to the PR #20 API: web routes elsewhere");
  const { access_token: token } = await login.json();
  const auth = json({ authorization: `Bearer ${token}` });
  try {
    const staging = await call(`${STAGING_API}/v1/auth/login`, { method: "POST", headers: json(), body: JSON.stringify(creds) });
    assert.equal(staging.status, 401, `Shared staging accepted the PR #20 account (${staging.status}): databases are not separate`);

    const orgs = await (await call(`${api}/v1/me/organizations`, { headers: auth })).json();
    const design = await call(`${api}/v1/orgs/${orgs[0].organization.id}/design`, { headers: auth });
    assert.equal(design.status, 200, "Design endpoints (migration 0009) do not answer");
    assert.equal((await design.json()).workspace_default, "atelier", "New workspace does not default to Atelier");
  } finally {
    const del = await call(`${api}/v1/me`, { method: "DELETE", headers: auth, body: JSON.stringify({ password: creds.password }) });
    assert.equal(del.status, 204, "Probe account clean-up failed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyPr20(...process.argv.slice(2));
  console.log("Verified: PR #20 API serves this commit; web routes to it; its database is separate from staging; 0009 is live; probe removed.");
}
