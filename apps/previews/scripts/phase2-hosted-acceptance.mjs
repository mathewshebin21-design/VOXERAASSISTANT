// Hosted acceptance for Phase 2 PRs #27 (shared rate limiter) and #28 (call records), run against a
// branch's OWN previews after the isolation gate (branch-isolation.mjs) has passed. No paid provider
// is called: the live brain is not used here. Reads no secrets and prints no hosts or credentials.
//
// Proves, through behaviour, on the branch API:
//   1. the API serves this commit and its database is ready;
//   2. login attempts are limited across instances: 5 wrong passwords, then 429 with Retry-After;
//      a forged x-vercel-forwarded-for does not buy new attempts (the platform sets that header);
//      and the per-email limit (10 in 15 minutes) holds once the per-address window has cleared;
//   3. a simulated call runs its lifecycle: start (idempotent), events in order, end once, read back;
//   4. without the recording notice no transcript words are stored;
//   5. another workspace cannot see or touch the call (404) and the call list is per workspace;
//   6. erasing a call removes it (owner), and the probe accounts are deleted again.
// Usage: node scripts/phase2-hosted-acceptance.mjs <branch> <full-sha> [--scope all|ratelimit]
//        node scripts/phase2-hosted-acceptance.mjs --api <origin> [--scope all|ratelimit]   (local runs)
// --scope ratelimit runs steps 1, 2 and 6 only (PR #27 has no call records).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { previewOrigins } from "./branch-isolation.mjs";

export async function phase2Acceptance(api, sha, { scope = "all", request = fetch, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  assert.ok(["all", "ratelimit"].includes(scope), "scope must be all or ratelimit");
  const call = (path, init = {}) =>
    request(`${api}${path}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  const send = (method, path, token, body, extra = {}) =>
    call(path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  if (sha) {
    const health = await (await call("/healthz")).json();
    assert.equal(health.commit, sha.slice(0, 7), "API is not serving this commit");
  }
  assert.equal((await call("/readyz")).status, 200, "API database is not ready");

  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const accounts = [];
  const signup = async (tag) => {
    const creds = { email: `phase2-${tag}-${run}@acceptance.example`, password: `phase2 ${run} ${tag} staple` };
    const r = await send("POST", "/v1/auth/signup", null, {
      ...creds,
      full_name: `Phase2 ${tag}`,
      organization_name: `Phase2 ${tag} ${run}`,
    });
    assert.equal(r.status, 201, `Sign-up failed (${r.status})`);
    const token = (await r.json()).access_token;
    const org = (await (await send("GET", "/v1/me/organizations", token)).json())[0].organization.id;
    const acct = { ...creds, token, org };
    accounts.push(acct);
    return acct;
  };

  try {
    const a = await signup("a");
    const b = await signup("b");

    // 2. Shared rate limiter.
    const codes = [];
    let retryAfter = null;
    for (let i = 0; i < 6; i++) {
      const r = await send("POST", "/v1/auth/login", null, { email: a.email, password: "wrong password" });
      codes.push(r.status);
      retryAfter = r.headers.get("retry-after");
    }
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429], `Login limit not enforced: ${codes}`);
    assert.ok(Number(retryAfter) >= 1 && Number(retryAfter) <= 120, "429 without a usable Retry-After");

    // 2b. A forged client-address header must not buy new attempts: the platform sets it, not callers.
    const forged = [];
    for (let i = 1; i <= 6; i++) {
      const r = await send("POST", "/v1/auth/login", null, { email: b.email, password: "wrong password" }, {
        "x-vercel-forwarded-for": `203.0.113.${i}`,
      });
      forged.push(r.status);
    }
    assert.deepEqual(forged, [401, 401, 401, 401, 401, 429], `Forged address header bypassed the limit: ${forged}`);

    // 2c. Per email, whatever the address: once the per-address window has cleared, the email's
    // attempts in the last 15 minutes (6 so far, refused ones included) still count to its limit of 10.
    await pause(125_000);
    const later = [];
    let emailRetry = null;
    for (let i = 0; i < 5; i++) {
      const r = await send("POST", "/v1/auth/login", null, { email: b.email, password: "wrong password" });
      later.push(r.status);
      emailRetry = r.headers.get("retry-after");
    }
    assert.deepEqual(later, [401, 401, 401, 401, 429], `Per-email limit not enforced: ${later}`);
    assert.ok(Number(emailRetry) > 60, `Per-email 429 should ask for a longer wait (Retry-After ${emailRetry})`);

    if (scope === "ratelimit") return;  // PR #27 alone has no call records

    // 3. Call lifecycle.
    const base = `/v1/orgs/${a.org}/calls`;
    const start = { channel: "simulated", external_ref: `acc-${run}`, ai_disclosure_played: true, recording_notice_played: true };
    const s1 = await send("POST", base, a.token, start);
    assert.equal(s1.status, 201, `Start call failed (${s1.status})`);
    const callRec = await s1.json();
    const s2 = await send("POST", base, a.token, start);
    assert.equal(s2.status, 200, "Starting the same call twice did not return the first");
    assert.equal((await s2.json()).id, callRec.id);
    const ev = await send("POST", `${base}/${callRec.id}/events`, a.token, {
      events: [
        { kind: "utterance", speaker: "caller", text: "Do you have anything on Friday?" },
        { kind: "tool", speaker: "agent", data: { name: "check_availability", ok: true } },
        { kind: "utterance", speaker: "agent", text: "Yes, 10am or 2pm." },
      ],
    });
    assert.equal(ev.status, 201, `Adding events failed (${ev.status})`);
    assert.deepEqual((await ev.json()).map((e) => e.seq), [1, 2, 3]);
    const end = await send("POST", `${base}/${callRec.id}/end`, a.token, { status: "completed", outcome: "answered" });
    assert.equal(end.status, 200, `Ending the call failed (${end.status})`);
    const ended = await end.json();
    assert.equal(ended.summary.caller_turns, 1);
    assert.deepEqual(ended.summary.tools, { check_availability: 1 });
    assert.equal((await send("POST", `${base}/${callRec.id}/end`, a.token, { status: "completed" })).status, 409);
    const after = await send("POST", `${base}/${callRec.id}/events`, a.token, { events: [{ kind: "system" }] });
    assert.equal(after.status, 409, "Events accepted after the call ended");
    const detail = await (await send("GET", `${base}/${callRec.id}`, a.token)).json();
    assert.equal(detail.events.length, 3);
    assert.equal(detail.audio_stored, false);

    // 4. Consent: no recording notice, no words.
    const quiet = await (await send("POST", base, a.token, { channel: "simulated", recording_notice_played: false })).json();
    await send("POST", `${base}/${quiet.id}/events`, a.token, { events: [{ kind: "utterance", speaker: "caller", text: "secret" }] });
    const quietDetail = await (await send("GET", `${base}/${quiet.id}`, a.token)).json();
    assert.equal(quietDetail.events[0].text, null, "Transcript stored without the recording notice");

    // 5. Tenant isolation.
    for (const [method, path, body] of [
      ["GET", `/v1/orgs/${a.org}/calls/${callRec.id}`],
      ["GET", `/v1/orgs/${b.org}/calls/${callRec.id}`],
      ["POST", `/v1/orgs/${b.org}/calls/${quiet.id}/events`, { events: [{ kind: "system" }] }],
      ["POST", `/v1/orgs/${b.org}/calls/${quiet.id}/end`, {}],
    ]) {
      const r = await send(method, path, b.token, body);
      assert.ok([403, 404].includes(r.status), `Other workspace reached the call: ${method} ${r.status}`);
    }
    assert.deepEqual(await (await send("GET", `/v1/orgs/${b.org}/calls`, b.token)).json(), []);

    // 6. Erasure.
    assert.equal((await send("DELETE", `${base}/${callRec.id}`, a.token)).status, 204);
    assert.equal((await send("GET", `${base}/${callRec.id}`, a.token)).status, 404);
  } finally {
    for (const acct of accounts) {
      const del = await send("DELETE", "/v1/me", acct.token, { password: acct.password });
      assert.equal(del.status, 204, "Probe account clean-up failed");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--scope");
  const scope = at >= 0 ? args.splice(at, 2)[1] : "all";
  let api;
  let sha;
  if (args[0] === "--api") {
    api = args[1];
    assert.ok(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api ?? ""), "--api is for local runs only");
  } else {
    const [branch, fullSha] = args;
    assert.match(fullSha ?? "", /^[a-f0-9]{40}$/, "Full Git commit required");
    api = previewOrigins(branch).api;
    sha = fullSha;
  }
  await phase2Acceptance(api, sha, { scope });
  console.log(
    scope === "ratelimit"
      ? "Verified: login limit shared and fail-safe; forged address ignored; per-email limit holds; probes removed."
      : "Verified: login limit shared and fail-safe; forged address ignored; per-email limit holds; call lifecycle, ordering, consent, tenant isolation and erasure; probes removed.",
  );
}
