// A read-only gate for the subsequent browser suite, which creates synthetic accounts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export async function verifyStaging(api, web, sha, request = fetch) {
  assert.equal(api, "https://voxera-api-git-staging-ai-e399.vercel.app", "Unexpected staging API origin");
  assert.equal(web, "https://voxera-flow-git-staging-ai-e399.vercel.app", "Unexpected staging web origin");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");

  async function read(url) {
    const response = await request(url, {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, "Staging identity endpoint unavailable");
    return response.json();
  }

  const backend = await read(api + "/staging-identity");
  assert.equal(backend.environment, "staging", "Runtime database is not marked staging");
  assert.equal(backend.commit, sha, "Staging API commit differs");
  const frontend = await read(web + "/api/staging-identity");
  assert.equal(frontend.commit, sha, "Staging web commit differs");
  assert.equal(frontend.usesStagingApi, true, "Web session handlers use a different API");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyStaging(...process.argv.slice(2));
  console.log("Verified staging database marker, web upstream and both deployment commits.");
}
