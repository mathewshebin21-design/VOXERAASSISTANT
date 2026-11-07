// Read-only gate before any synthetic write to the isolated RC-1 Preview.
// Proves, from the live runtime connection: the commit, the dedicated database marker
// (staging), the restricted runtime role, and the schema; and that the web Preview's
// server handlers use exactly this API.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const RC1_API = "https://voxera-api-git-codex-rc1-validation-ai-e399.vercel.app";
export const RC1_WEB = "https://voxera-flow-git-codex-rc1-validation-ai-e399.vercel.app";
export const RC1_SCHEMA = "0007";

export async function verifyRc1(api, web, sha, request = fetch) {
  assert.equal(api, RC1_API, "Unexpected RC-1 API origin");
  assert.equal(web, RC1_WEB, "Unexpected RC-1 web origin");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");

  async function read(url) {
    const response = await request(url, {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, "RC-1 identity endpoint unavailable");
    return response.json();
  }

  const backend = await read(api + "/rc1-identity");
  assert.equal(backend.profile, "rc1-validation", "API is not running the RC-1 profile");
  assert.equal(backend.commit, sha, "RC-1 API commit differs");
  assert.equal(backend.environment, "staging", "Runtime database is not marked staging");
  assert.equal(backend.schema, RC1_SCHEMA, "Runtime database schema differs");
  assert.equal(backend.runtime_role, true, "Runtime connection is not the restricted role");
  assert.equal(backend.superuser, false, "Runtime role is a superuser");
  assert.equal(backend.bypass_rls, false, "Runtime role bypasses row-level security");
  assert.equal(backend.dedicated_database, true, "Runtime database is not the dedicated database");
  const frontend = await read(web + "/api/rc1-identity");
  assert.equal(frontend.commit, sha, "RC-1 web commit differs");
  assert.equal(frontend.usesRc1Api, true, "Web session handlers use a different API");
  return backend;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyRc1(...process.argv.slice(2));
  console.log("Verified RC-1: commit, staging marker, schema 0007, restricted role, dedicated database, web upstream.");
}
