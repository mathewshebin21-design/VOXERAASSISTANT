import assert from "node:assert/strict";
import test from "node:test";
import { checkOnce, probe, waitForStaging } from "./wait-for-deploy.mjs";

const api = "https://voxera-api-git-staging-ai-e399.vercel.app";
const web = "https://voxera-flow-git-staging-ai-e399.vercel.app";
const sha = "a".repeat(40);
const other = "b".repeat(40);

// What Vercel served during staging run #1: its building page, with status 200.
const BUILDING_PAGE = '<!DOCTYPE html><html><head><title>Deployment is building</title></head><body>This page will update once the build completes.</body></html>';

const json = (body, status = 200) => Response.json(body, { status });
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// A fake network: maps URL → response factory (or a list consumed one per call).
function network(routes) {
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options]);
    let route = routes[url];
    if (Array.isArray(route)) route = route.length > 1 ? route.shift() : route[0];
    if (!route) throw new Error(`unexpected URL ${url}`);
    if (route instanceof Error) throw route;
    return route();
  };
  return { request, calls };
}

const healthy = (webCommit = sha, apiCommit = sha) => ({
  [`${api}/readyz`]: () => json({ status: "ready" }),
  [`${api}/staging-identity`]: () => json({ commit: apiCommit, environment: "staging" }),
  [`${web}/api/staging-identity`]: () => json({ commit: webCommit, usesStagingApi: true }),
});

test("ready when both identity endpoints report the exact commit", async () => {
  const { request } = network(healthy());
  assert.deepEqual(await checkOnce(api, web, sha, request), { ready: true, api: "ok", web: "ok" });
});

test("regression: an HTTP 200 'Deployment is building' page is not readiness evidence", async () => {
  const { request } = network({ ...healthy(), [`${web}/api/staging-identity`]: () => html(BUILDING_PAGE) });
  const r = await checkOnce(api, web, sha, request);
  assert.equal(r.ready, false);
  assert.equal(r.api, "ok");
  assert.match(r.web, /HTTP 200 HTML page "Deployment is building"/);
});

test("an HTML page without a content-type header is still rejected", async () => {
  const { request } = network({ ...healthy(), [`${web}/api/staging-identity`]: () => new Response(BUILDING_PAGE, { status: 200 }) });
  assert.match((await checkOnce(api, web, sha, request)).web, /HTML page/);
});

test("the API's building page is rejected too", async () => {
  const { request } = network({ ...healthy(), [`${api}/readyz`]: () => html(BUILDING_PAGE) });
  const r = await checkOnce(api, web, sha, request);
  assert.equal(r.ready, false);
  assert.match(r.api, /^readyz: HTTP 200 HTML page/);
});

for (const [name, response, pattern] of [
  ["Vercel login / SSO redirect", () => new Response(null, { status: 307, headers: { location: "https://vercel.com/sso-api?url=x" } }), /redirect 307 to https:\/\/vercel\.com\/sso-api.*protection/],
  ["deployment protection 401", () => html("<html><title>Authentication Required</title></html>", 401), /401: login or deployment-protection page/],
  ["forbidden 403", () => new Response("denied", { status: 403 }), /403: login or deployment-protection page/],
  ["Vercel error page 404", () => html("<html><title>404: NOT_FOUND</title></html>", 404), /HTTP 404 HTML page "404: NOT_FOUND"/],
  ["server error JSON", () => json({ detail: "boom" }, 500), /^HTTP 500$/],
  ["plain-text 200", () => new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }), /not JSON/],
  ["broken JSON", () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }), /not valid JSON/],
  ["network failure", () => { throw new TypeError("fetch failed"); }, /unreachable \(fetch failed\)/],
]) {
  test(`rejected as evidence: ${name}`, async () => {
    const r = await probe(`${web}/api/staging-identity`, async () => response());
    assert.equal(r.ok, false);
    assert.match(r.reason, pattern);
  });
}

test("a short SHA prefix does not count: the full commit must match", async () => {
  const { request } = network(healthy(sha.slice(0, 7)));
  const r = await checkOnce(api, web, sha, request);
  assert.equal(r.ready, false);
  assert.match(r.web, /serves commit aaaaaaa, expected a{40}/);
});

test("an older API commit is not ready", async () => {
  const { request } = network(healthy(sha, other));
  assert.match((await checkOnce(api, web, sha, request)).api, /API serves commit b{40}/);
});

test("API readiness also needs /readyz 200 (e.g. database guard 503)", async () => {
  const { request } = network({ ...healthy(), [`${api}/readyz`]: () => json({ status: "unavailable" }, 503) });
  assert.match((await checkOnce(api, web, sha, request)).api, /^readyz: HTTP 503$/);
});

test("probes are GETs that never follow redirects", async () => {
  const { request, calls } = network(healthy());
  await checkOnce(api, web, sha, request);
  assert.deepEqual(calls.map(([u]) => u), [`${api}/readyz`, `${api}/staging-identity`, `${web}/api/staging-identity`]);
  for (const [, o] of calls) { assert.equal(o.method, "GET"); assert.equal(o.redirect, "manual"); }
});

// Polling with a fake clock: no real waiting.
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test("polling: waits through the building page, then succeeds once the real identity appears", async () => {
  const { request } = network({
    ...healthy(),
    [`${web}/api/staging-identity`]: [() => html(BUILDING_PAGE), () => html(BUILDING_PAGE), () => json({ commit: sha, usesStagingApi: true })],
  });
  const lines = [];
  const r = await waitForStaging(api, web, sha, { request, ...clock(), log: (l) => lines.push(l) });
  assert.equal(r.attempts, 3);
  assert.match(lines[0], /web: HTTP 200 HTML page "Deployment is building"/);
});

test("polling is bounded and the timeout names the last state of each endpoint", async () => {
  const { request } = network({ ...healthy(), [`${web}/api/staging-identity`]: () => html(BUILDING_PAGE) });
  const lines = [];
  await assert.rejects(
    waitForStaging(api, web, sha, { request, ...clock(), timeoutMs: 60_000, intervalMs: 15_000, log: (l) => lines.push(l) }),
    (e) => {
      assert.match(e.message, /Timed out after 5 checks \(60s\) waiting for a{40}/);
      assert.match(e.message, /last API state: ok/);
      assert.match(e.message, /last web state: HTTP 200 HTML page "Deployment is building"/);
      return true;
    },
  );
  assert.equal(lines.length, 5); // checks at 0, 15, 30, 45 and 60 s
});

test("a short or missing SHA is refused before any request", async () => {
  const { request, calls } = network(healthy());
  await assert.rejects(waitForStaging(api, web, "94dae66", { request, ...clock() }), /full 40-character commit SHA/);
  await assert.rejects(waitForStaging(api, web, undefined, { request, ...clock() }), /full 40-character commit SHA/);
  assert.equal(calls.length, 0);
});
