import assert from "node:assert/strict";
import test from "node:test";
import { RC1_API as api, RC1_WEB as web, verifyRc1 } from "./rc1-isolation.mjs";

const sha = "a".repeat(40);
const backend = {
  profile: "rc1-validation", commit: sha, environment: "staging", schema: "0007",
  runtime_role: true, superuser: false, bypass_rls: false, dedicated_database: true,
};
const frontend = { commit: sha, usesRc1Api: true };

for (const [name, apiOrigin, webOrigin, ref, responses, expected] of [
  ["verified configuration", api, web, sha, [backend, frontend], true],
  ["production API", "https://voxera-api-two.vercel.app", web, sha, [], false],
  ["staging API", "https://voxera-api-git-staging-ai-e399.vercel.app", web, sha, [], false],
  ["staging web", api, "https://voxera-flow-git-staging-ai-e399.vercel.app", sha, [], false],
  ["missing SHA", api, web, "", [], false],
  ["not the RC-1 profile", api, web, sha, [404], false],
  ["wrong profile", api, web, sha, [{ ...backend, profile: "other" }], false],
  ["wrong DB marker", api, web, sha, [{ ...backend, environment: "production" }], false],
  ["unclaimed DB", api, web, sha, [{ ...backend, environment: null }], false],
  ["wrong schema", api, web, sha, [{ ...backend, schema: "0008" }], false],
  ["unreadable schema", api, web, sha, [{ ...backend, schema: null }], false],
  ["owner role", api, web, sha, [{ ...backend, runtime_role: false }], false],
  ["superuser", api, web, sha, [{ ...backend, superuser: true }], false],
  ["bypasses RLS", api, web, sha, [{ ...backend, bypass_rls: true }], false],
  ["shared database", api, web, sha, [{ ...backend, dedicated_database: false }], false],
  ["wrong API revision", api, web, sha, [{ ...backend, commit: "old" }], false],
  ["wrong web revision", api, web, sha, [backend, { ...frontend, commit: "old" }], false],
  ["wrong web upstream", api, web, sha, [backend, { ...frontend, usesRc1Api: false }], false],
]) {
  test(name, async () => {
    const requests = [];
    const request = async (url, options) => {
      requests.push([url, options]);
      const body = responses[requests.length - 1];
      return typeof body === "number" ? new Response(null, { status: body }) : Response.json(body);
    };
    const probe = verifyRc1(apiOrigin, webOrigin, ref, request);
    if (expected) await probe;
    else await assert.rejects(probe);
    assert.equal(requests.length, responses.length);
    assert.deepEqual(requests.map(([url]) => url), [api + "/rc1-identity", web + "/api/rc1-identity"].slice(0, responses.length));
    for (const [, options] of requests) {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
    }
  });
}
