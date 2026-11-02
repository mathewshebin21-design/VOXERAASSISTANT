import assert from "node:assert/strict";
import test from "node:test";
import { verifyStaging } from "./staging-isolation.mjs";

const api = "https://voxera-api-git-staging-ai-e399.vercel.app";
const web = "https://voxera-flow-git-staging-ai-e399.vercel.app";
const sha = "a".repeat(40);
const backend = { commit: sha, environment: "staging" };
const frontend = { commit: sha, usesStagingApi: true };

for (const [name, apiOrigin, webOrigin, ref, responses, expected] of [
  ["verified configuration", api, web, sha, [backend, frontend], true],
  ["production API", "https://voxera-api-two.vercel.app", web, sha, [], false],
  ["production web", api, "https://voxera-flow.vercel.app", sha, [], false],
  ["missing SHA", api, web, "", [], false],
  ["guard refusal", api, web, sha, [503], false],
  ["wrong DB", api, web, sha, [{ ...backend, environment: "production" }], false],
  ["wrong API revision", api, web, sha, [{ ...backend, commit: "old" }], false],
  ["wrong web revision", api, web, sha, [backend, { ...frontend, commit: "old" }], false],
  ["wrong web upstream", api, web, sha, [backend, { ...frontend, usesStagingApi: false }], false],
  // Regression (staging run #1): Vercel's building page arrived as HTML with status 200.
  ["web building page (HTML 200)", api, web, sha, [backend, "<!DOCTYPE html><title>Deployment is building</title>"], false],
  ["API building page (HTML 200)", api, web, sha, ["<!DOCTYPE html><title>Deployment is building</title>"], false],
]) {
  test(name, async () => {
    const requests = [];
    const request = async (url, options) => {
      requests.push([url, options]);
      const body = responses[requests.length - 1];
      if (typeof body === "number") return new Response(null, { status: body });
      if (typeof body === "string") return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
      return Response.json(body);
    };
    const probe = verifyStaging(apiOrigin, webOrigin, ref, request);
    if (expected) await probe;
    else await assert.rejects(probe);
    assert.equal(requests.length, responses.length);
    assert.deepEqual(requests.map(([url]) => url), [api + "/staging-identity", web + "/api/staging-identity"].slice(0, responses.length));
    for (const [, options] of requests) {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
    }
  });
}
