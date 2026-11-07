import assert from "node:assert/strict";
import test from "node:test";
import { PR20_API as api, PR20_WEB as web, STAGING_API, verifyPr20 } from "./pr20-isolation.mjs";

const sha = "b".repeat(40);

// A fake network: each case overrides one answer of an otherwise healthy, isolated setup.
function network(over = {}) {
  const calls = [];
  const answer = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const request = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace(/\/v1\/orgs\/[^/]+/, "/v1/orgs/:id")}`;
    calls.push(key);
    if (key in over) return over[key]();
    switch (key) {
      case `GET ${api}/healthz`: return answer(200, { commit: sha.slice(0, 7) });
      case `GET ${api}/readyz`: return answer(200, { status: "ready" });
      case `POST ${web}/api/session/signup`: return answer(201, { ok: true });
      case `POST ${api}/v1/auth/login`: return answer(200, { access_token: "t" });
      case `POST ${STAGING_API}/v1/auth/login`: return answer(401, {});
      case `GET ${api}/v1/me/organizations`: return answer(200, [{ organization: { id: "o" } }]);
      case `GET ${api}/v1/orgs/:id/design`: return answer(200, { workspace_default: "atelier" });
      case `DELETE ${api}/v1/me`: return answer(204, null);
      default: throw new Error(`unexpected ${key}`);
    }
  };
  return { request, calls, answer };
}

test("verified, isolated setup passes and deletes the probe", async () => {
  const n = network();
  await verifyPr20(api, web, sha, n.request);
  assert.ok(n.calls.includes(`DELETE ${api}/v1/me`));
});

for (const [name, a, w, ref] of [
  ["production API", "https://voxera-api-two.vercel.app", web, sha],
  ["staging API", STAGING_API, web, sha],
  ["staging web", api, "https://voxera-flow-git-staging-ai-e399.vercel.app", sha],
  ["short SHA", api, web, "bbbbbbb"],
]) {
  test(`refuses ${name} before any request`, async () => {
    const n = network();
    await assert.rejects(verifyPr20(a, w, ref, n.request));
    assert.equal(n.calls.length, 0);
  });
}

const fail = (status, body = {}) => () => ({ status, ok: status < 300, json: async () => body });
for (const [name, over, cleaned] of [
  ["old commit deployed", { [`GET ${api}/healthz`]: fail(200, { commit: "0000000" }) }, false],
  ["database not ready", { [`GET ${api}/readyz`]: fail(503) }, false],
  ["web routes to another API", { [`POST ${api}/v1/auth/login`]: fail(401) }, false],
  ["staging shares the database", { [`POST ${STAGING_API}/v1/auth/login`]: fail(200, {}) }, true],
  ["design endpoints missing", { [`GET ${api}/v1/orgs/:id/design`]: fail(404) }, true],
]) {
  test(`fails when ${name}`, async () => {
    const n = network(over);
    await assert.rejects(verifyPr20(api, web, sha, n.request));
    assert.equal(n.calls.includes(`DELETE ${api}/v1/me`), cleaned, "probe account is removed once it exists");
  });
}
