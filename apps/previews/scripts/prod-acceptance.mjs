// Phase 1 customer-workflow acceptance against PRODUCTION. Runs only with the owner's explicit
// approval, through .github/workflows/phase1-prod-acceptance.yml.
//
// It reuses the RC-1 acceptance suite (rc1-acceptance.mjs) on synthetic accounts only:
// authentication and sessions, rate limiting, JWT handling, saved configuration, scheduling,
// concurrency, rescheduling, cancellation, tenant isolation, staff/viewer permissions, security
// headers and reliability. Every synthetic account and workspace is deleted at the end, and each
// deleted account must then fail to sign in.
//
// Safety:
// - A read-only gate runs first. Nothing is written unless production is serving exactly the
//   expected commit, is ready, and is in production mode (HSTS on, /docs off, no preview-only
//   identity endpoints).
// - The synthetic password is random per run and never printed or saved.
// - No paid provider is called: the suite uses only staff REST endpoints.
//
// Usage: node scripts/prod-acceptance.mjs <api> <web> <expected-full-sha> [evidence.json]
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runAcceptance } from "./rc1-acceptance.mjs";

export const PROD_API = "https://voxera-api-two.vercel.app";
export const PROD_WEB = "https://voxera-flow.vercel.app";
export const EMAIL_DOMAIN = "prod-acceptance.example";

/** Read-only production gate. Throws, without writing anything, unless every condition holds. */
export async function verifyProduction(api, web, sha, request = fetch) {
  assert.equal(api, PROD_API, "Unexpected production API origin");
  assert.equal(web, PROD_WEB, "Unexpected production web origin");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");
  const get = (url) => request(url, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });

  const health = await get(`${api}/healthz`);
  assert.equal(health.status, 200, "Production /healthz unavailable");
  assert.equal((await health.json()).commit, sha.slice(0, 7), "Production is not serving the expected commit");
  assert.ok(health.headers.get("strict-transport-security"), "HSTS missing: API is not in production mode");
  assert.equal((await get(`${api}/readyz`)).status, 200, "Production database is not ready");
  assert.equal((await get(`${api}/docs`)).status, 404, "/docs is exposed: API is not in production mode");
  assert.equal((await get(`${api}/staging-identity`)).status, 404, "Staging identity endpoint answers: not production");
  assert.equal((await get(`${api}/rc1-identity`)).status, 404, "RC-1 identity endpoint answers: not production");
  assert.equal((await get(`${web}/start`)).status, 200, "Production web app unavailable");
  return { environment: "production", commit: sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [api, web, sha, out = "prod-acceptance.json"] = process.argv.slice(2);
  const identity = await verifyProduction(api, web, sha); // throws (no writes) unless proven
  console.log(`Verified production: commit ${sha.slice(0, 7)}, ready, production mode. Starting synthetic acceptance.`);
  const failed = await runAcceptance({
    api, web, sha, identity, out,
    password: `${randomBytes(24).toString("base64url")}-Vx9`,
    emailDomain: EMAIL_DOMAIN,
    label: "PROD-ACCEPTANCE",
    proveCleanup: true,
    finalIdentity: () => verifyProduction(api, web, sha).then(() => true, () => false),
  });
  process.exit(failed ? 1 : 0);
}
