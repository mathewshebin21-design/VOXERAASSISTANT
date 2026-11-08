import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCTION_API, STAGING_API, previewOrigins, verifyBranch } from "./branch-isolation.mjs";

const sha = "c".repeat(40);
const branch = "claude/start-auth-routing";
const { api, web } = previewOrigins(branch);

function network(over = {}) {
  const calls = [];
  const answer = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const request = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace(/\/v1\/orgs\/[^/]+/, "/v1/orgs/:id")}`;
    calls.push(key);
    if (key in over) return over[key]();
    switch (key) {
      case `GET ${api}/healthz`: return answer(200, { commit: sha.slice(0, 7) });
      case `GET ${api}/readyz`: return answer(200, {});
      case `POST ${web}/api/session/signup`: return answer(201, { ok: true });
      case `POST ${api}/v1/auth/login`: return answer(200, { access_token: "t" });
      case `POST ${STAGING_API}/v1/auth/login`: return answer(401, {});
      case `POST ${PRODUCTION_API}/v1/auth/login`: return answer(401, {});
      case `GET ${api}/v1/me/organizations`: return answer(200, [{ organization: { id: "o" } }]);
      case `GET ${api}/v1/orgs/:id/design`: return answer(200, { workspace_default: "atelier" });
      case `DELETE ${api}/v1/me`: return answer(204, null);
      default: throw new Error(`unexpected ${key}`);
    }
  };
  return { request, calls };
}
const fail = (status, body = {}) => () => ({ status, ok: status < 300, json: async () => body });

test("derives the branch preview origins", () => {
  assert.equal(api, "https://voxera-api-git-claude-start-auth-routing-ai-e399.vercel.app");
  assert.equal(web, "https://voxera-flow-git-claude-start-auth-routing-ai-e399.vercel.app");
});

for (const b of ["claude/confident-shannon-7nb05f", "staging", "codex/rc1-validation", "main", "", "bad branch", "a".repeat(81), "x/" + "y".repeat(60)]) {
  test(`refuses ${JSON.stringify(b).slice(0, 40)} before any request`, async () => {
    const n = network();
    await assert.rejects(verifyBranch(b, sha, n.request));
    assert.equal(n.calls.length, 0);
  });
}

test("isolated branch passes and deletes the probe", async () => {
  const n = network();
  await verifyBranch(branch, sha, n.request);
  assert.ok(n.calls.includes(`DELETE ${api}/v1/me`));
});

for (const [name, over, cleaned] of [
  ["old commit deployed", { [`GET ${api}/healthz`]: fail(200, { commit: "0000000" }) }, false],
  ["web routes to another API", { [`POST ${api}/v1/auth/login`]: fail(401) }, false],
  ["staging shares the database", { [`POST ${STAGING_API}/v1/auth/login`]: fail(200) }, true],
  ["production shares the database", { [`POST ${PRODUCTION_API}/v1/auth/login`]: fail(200) }, true],
  ["design endpoints missing", { [`GET ${api}/v1/orgs/:id/design`]: fail(404) }, true],
]) {
  test(`fails when ${name}`, async () => {
    const n = network(over);
    await assert.rejects(verifyBranch(branch, sha, n.request));
    assert.equal(n.calls.includes(`DELETE ${api}/v1/me`), cleaned);
  });
}
