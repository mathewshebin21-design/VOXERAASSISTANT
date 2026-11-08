import assert from "node:assert/strict";
import test from "node:test";
import { PROD_API, PROD_WEB, verifyProduction } from "./prod-acceptance.mjs";

const sha = "6".repeat(40);

function network(over = {}) {
  const calls = [];
  const res = (status, body = {}, headers = {}) => ({ status, json: async () => body, headers: new Headers(headers) });
  const request = async (url) => {
    calls.push(url);
    if (url in over) return over[url]();
    switch (url) {
      case `${PROD_API}/healthz`: return res(200, { commit: sha.slice(0, 7) }, { "strict-transport-security": "max-age=31536000" });
      case `${PROD_API}/readyz`: return res(200);
      case `${PROD_API}/docs`: return res(404);
      case `${PROD_API}/staging-identity`: return res(404);
      case `${PROD_API}/rc1-identity`: return res(404);
      case `${PROD_WEB}/start`: return res(200);
      default: throw new Error(`unexpected ${url}`);
    }
  };
  return { request, calls };
}
const r = (status, body = {}, headers = {}) => () => ({ status, json: async () => body, headers: new Headers(headers) });

test("passes when production serves the commit, is ready and is in production mode", async () => {
  assert.deepEqual(await verifyProduction(PROD_API, PROD_WEB, sha, network().request), { environment: "production", commit: sha });
});

for (const [name, args] of [
  ["another API origin", ["https://voxera-api-git-staging-ai-e399.vercel.app", PROD_WEB, sha]],
  ["another web origin", [PROD_API, "https://voxera-flow-git-staging-ai-e399.vercel.app", sha]],
  ["a short commit", [PROD_API, PROD_WEB, "667eec1"]],
]) {
  test(`refuses ${name} before any request`, async () => {
    const n = network();
    await assert.rejects(verifyProduction(...args, n.request));
    assert.equal(n.calls.length, 0);
  });
}

for (const [name, over] of [
  ["a different deployed commit", { [`${PROD_API}/healthz`]: r(200, { commit: "0000000" }, { "strict-transport-security": "x" }) }],
  ["no HSTS (not production mode)", { [`${PROD_API}/healthz`]: r(200, { commit: sha.slice(0, 7) }) }],
  ["a database that is not ready", { [`${PROD_API}/readyz`]: r(503) }],
  ["/docs exposed", { [`${PROD_API}/docs`]: r(200) }],
  ["a staging identity endpoint", { [`${PROD_API}/staging-identity`]: r(200) }],
  ["an RC-1 identity endpoint", { [`${PROD_API}/rc1-identity`]: r(200) }],
  ["the web app down", { [`${PROD_WEB}/start`]: r(500) }],
]) {
  test(`refuses ${name}`, async () => {
    await assert.rejects(verifyProduction(PROD_API, PROD_WEB, sha, network(over).request));
  });
}
