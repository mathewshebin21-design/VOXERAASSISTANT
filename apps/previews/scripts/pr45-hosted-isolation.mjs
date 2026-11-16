// PR45 isolated hosted acceptance. Synthetic data only; no real calls or providers.
// The fixed origins and deployed source commit are checked before any write.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const API = "https://voxera-jerlhsnnc-ai-e399.vercel.app";
const WEB = "https://voxera-flow-qgymfyvhg-ai-e399.vercel.app";
const STAGING = "https://voxera-api-git-staging-ai-e399.vercel.app";
const PRODUCTION = "https://voxera-api-two.vercel.app";
const APPLICATION_SHA = "2839e460003255edb084daa201a813ef5aa63ea8";

const json = (value) => JSON.stringify(value);
const request = (origin, path, options = {}) =>
  fetch(origin + path, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    ...options,
  });
const send = (origin, method, path, body, token, extra = {}) =>
  request(origin, path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : json(body),
  });
const auth = (token) => ({ headers: { authorization: "Bearer " + token } });
const expectCode = (r, code, label) =>
  assert.equal(r.status, code, label + " returned HTTP " + r.status);
const denied = (r, label) =>
  assert.ok([403, 404].includes(r.status), label + " must be denied without disclosing tenancy");

export async function accept({ api = API, web = WEB, staging = STAGING, production = PRODUCTION,
  applicationSha = APPLICATION_SHA } = {}) {
  assert.equal(api, API);
  assert.equal(web, WEB);
  assert.equal(applicationSha, APPLICATION_SHA);
  expectCode(await request(api, "/healthz"), 200, "API health");
  const health = await (await request(api, "/healthz")).json();
  assert.equal(health.commit, applicationSha.slice(0, 7), "Wrong deployed application revision");
  expectCode(await request(api, "/readyz"), 200, "Isolated database readiness");
  expectCode(await request(web, "/"), 200, "PR45 frontend");

  const run = Date.now().toString(36);
  const accounts = [];
  async function newAccount(label, throughWeb) {
    const account = {
      email: "pr45-" + label + "-" + run + "@acceptance.example",
      password: "PR45 " + run + " " + label + " horse battery staple",
      created: false,
      token: null,
      org: null,
    };
    accounts.push(account);
    const data = {
      email: account.email, password: account.password,
      full_name: "PR45 synthetic " + label,
      organization_name: "PR45 " + label + " " + run,
    };
    const signup = throughWeb
      ? await send(web, "POST", "/api/session/signup", data, null, { "x-voxera-csrf": "1" })
      : await send(api, "POST", "/v1/auth/signup", data);
    expectCode(signup, 201, label + " signup");
    account.created = true;
    const login = await send(api, "POST", "/v1/auth/login", {
      email: account.email, password: account.password,
    });
    expectCode(login, 200, label + " login to isolated API");
    account.token = (await login.json()).access_token;
    const memberships = await request(api, "/v1/me/organizations", auth(account.token));
    expectCode(memberships, 200, label + " organizations");
    account.org = (await memberships.json())[0].organization.id;
    assert.ok(account.org, "Workspace was not provisioned");
    return account;
  }

  let failure;
  try {
    const a = await newAccount("a", true);
    const b = await newAccount("b", false);
    assert.notEqual(a.org, b.org, "Synthetic tenants must be distinct");

    for (const [name, other] of [["shared staging", staging], ["production", production]]) {
      const login = await send(other, "POST", "/v1/auth/login", {
        email: a.email, password: a.password,
      });
      expectCode(login, 401, name + " isolated-account rejection");
    }

    const rootA = "/v1/orgs/" + a.org;
    const rootB = "/v1/orgs/" + b.org;
    const getA = (p) => request(api, rootA + p, auth(a.token));
    const getB = (p) => request(api, rootB + p, auth(b.token));

    const defaultA = await getA("/voice/policy");
    const defaultB = await getB("/voice/policy");
    expectCode(defaultA, 200, "A default voice policy");
    expectCode(defaultB, 200, "B default voice policy");
    assert.equal((await defaultA.json()).saved, false);
    assert.equal((await defaultB.json()).saved, false);

    const policy = {
      default_language: "en-GB",
      languages: ["en-GB", "hi-IN"],
      fallback_language: "en-GB",
      allowed_regions: ["device", "uk", "eu"],
      blocked_providers: ["deepgram"],
      preferred_providers: ["kokoro"],
      allow_paid: false,
      allow_unverified: false,
    };
    const saved = await send(api, "PUT", rootA + "/voice/policy", policy, a.token);
    expectCode(saved, 200, "Save A voice policy");
    assert.equal((await saved.json()).saved, true);
    assert.equal((await (await getB("/voice/policy")).json()).saved, false,
      "B must not inherit A voice policy");
    denied(await request(api, rootA + "/voice/policy", auth(b.token)), "Cross-tenant policy read");
    denied(await send(api, "PUT", rootA + "/voice/policy", policy, b.token),
      "Cross-tenant policy modification");

    for (const [label, user, root] of [["A", a, rootA], ["B", b, rootB]]) {
      const numbers = await request(api, root + "/voice/numbers", auth(user.token));
      expectCode(numbers, 200, label + " assigned-number list");
      assert.deepEqual(await numbers.json(), [], "No synthetic number should be assigned");
    }
    denied(await request(api, rootA + "/voice/numbers", auth(b.token)),
      "Cross-tenant assigned-number read");

    const base = rootA + "/calls";
    const input = {
      channel: "simulated",
      external_ref: "pr45-" + run,
      ai_disclosure_played: false,
      recording_notice_played: false,
    };
    const started = await send(api, "POST", base, input, a.token);
    expectCode(started, 201, "Simulated call start");
    const call = await started.json();
    assert.equal(call.transcript_retained, false);
    assert.equal(call.audio_stored, false);
    const repeat = await send(api, "POST", base, input, a.token);
    expectCode(repeat, 200, "Call idempotency");
    assert.equal((await repeat.json()).id, call.id);

    const appended = await send(api, "POST", base + "/" + call.id + "/events", {
      events: [{ kind: "utterance", speaker: "caller", text: "synthetic private words" }],
    }, a.token);
    expectCode(appended, 201, "Simulated event append");
    const detail = await request(api, base + "/" + call.id, auth(a.token));
    expectCode(detail, 200, "Read simulated call");
    const record = await detail.json();
    assert.equal(record.audio_stored, false);
    assert.equal(record.transcript_retained, false);
    assert.equal(record.events.length, 1);
    assert.equal(record.events[0].text, null, "Words retained without recording notice");

    denied(await request(api, rootB + "/calls/" + call.id, auth(b.token)),
      "Cross-tenant call read");
    denied(await request(api, base + "/" + call.id, auth(b.token)),
      "Cross-tenant call by ID");
    const ended = await send(api, "POST", base + "/" + call.id + "/end",
      { status: "completed", outcome: "no_action" }, a.token);
    expectCode(ended, 200, "Simulated call completion");
    const late = await send(api, "POST", base + "/" + call.id + "/events",
      { events: [{ kind: "system" }] }, a.token);
    expectCode(late, 409, "Events after completion");
    expectCode(await send(api, "DELETE", base + "/" + call.id, undefined, a.token),
      204, "Synthetic call erasure");

    // The two synthetic accounts own no real resources. Deleting them cascades their
    // isolated workspaces and voice policy, avoiding persistent test data.
  } catch (e) {
    failure = e;
  } finally {
    for (const account of accounts.reverse()) {
      if (!account.created) continue;
      try {
        if (!account.token) {
          const login = await send(api, "POST", "/v1/auth/login", {
            email: account.email, password: account.password,
          });
          if (login.status === 200) account.token = (await login.json()).access_token;
        }
        assert.ok(account.token, "Cannot clean up synthetic account " + account.email);
        const cleaned = await send(api, "DELETE", "/v1/me",
          { password: account.password }, account.token);
        expectCode(cleaned, 204, "Synthetic account cleanup");
      } catch (e) {
        failure ??= e;
      }
    }
  }
  if (failure) throw failure;
  console.log("PR45 hosted tenant, policy, number, call-consent and isolation acceptance passed; accounts removed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await accept();
}
