// Hosted API acceptance for the isolated RC-1 Preview. Synthetic data only; no paid providers.
// Refuses to write anything unless the read-only isolation gate (rc1-isolation.mjs) passes first.
// Usage: node scripts/rc1-acceptance.mjs <api> <web> <full-sha> [evidence.json]
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyRc1 } from "./rc1-isolation.mjs";

// The CLI entry (bottom) always runs the isolation gate first. runAcceptance is exported
// only so the suite itself can be exercised against a local API before a hosted run.
// Options (defaults keep the RC-1 behaviour unchanged):
//   password      per-run secret; never printed or written to the evidence file
//   emailDomain   synthetic account domain
//   label         prefix for synthetic names (accounts, workspaces, services)
//   finalIdentity async () => boolean: re-checks the target after the writes
//   proveCleanup  after deleting the accounts, require each sign-in to be refused (401)
export async function runAcceptance({
  api: API, web: WEB, sha: SHA, identity, out: OUT,
  password, emailDomain = "rc1-acceptance.example", label: LABEL = "RC1", finalIdentity, proveCleanup = false,
}) {
const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const PW = password ?? "correct horse battery staple";
const results = [];
const check = (area, name, ok, detail = "") => {
  results.push({ area, name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${detail && !ok ? "  — " + detail : ""}`);
};
const note = (area, name, detail) => {
  results.push({ area, name, ok: null, detail });
  console.log(`NOTE  [${area}] ${name} — ${detail}`);
};

async function call(method, path, { token, body, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    redirect: "error",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
const area = async (name, fn) => {
  try { await fn(); } catch (e) { check(name, "section completed without an exception", false, String(e)); }
};

// ---------- accounts ----------
const accounts = [];
async function signup(label, org) {
  const email = `${label}-${run}@${emailDomain}`;
  const r = await call("POST", "/v1/auth/signup", {
    body: { email, password: PW, full_name: `${LABEL} ${label}`, organization_name: org },
  });
  const a = { label, email, token: r.json?.access_token, refresh: r.json?.refresh_token, status: r.status };
  if (r.status === 201) {
    accounts.push(a);
    a.orgId = (await call("GET", "/v1/me/organizations", { token: a.token })).json?.[0]?.organization?.id;
    a.userId = (await call("GET", "/v1/me", { token: a.token })).json?.id;
  }
  return a;
}
const o = (a, p = "") => `/v1/orgs/${a.orgId}${p}`;

let A, B, viewer, staff;

await area("auth", async () => {
  A = await signup("owner-a", `${LABEL} Clinic A ${run}`);
  check("auth", "sign-up creates an account and workspace (201)", A.status === 201 && A.orgId, A.status);
  B = await signup("owner-b", `${LABEL} Clinic B ${run}`);
  check("auth", "second tenant sign-up (201)", B.status === 201 && B.orgId, B.status);
  check("auth", "duplicate e-mail rejected", (await call("POST", "/v1/auth/signup", {
    body: { email: A.email, password: PW, full_name: "Dup", organization_name: "Dup" },
  })).status >= 400);
  check("auth", "trivial password rejected (422)", (await call("POST", "/v1/auth/signup", {
    body: { email: `weak-${run}@${emailDomain}`, password: "aaaaaaaaaaaa", full_name: "W", organization_name: "W" },
  })).status === 422);
  const bad = await call("POST", "/v1/auth/login", { body: { email: A.email, password: "wrong password here" } });
  check("auth", "wrong password rejected (401)", bad.status === 401, bad.status);
  check("auth", "login failure does not reveal whether the account exists",
    bad.json?.detail === (await call("POST", "/v1/auth/login", { body: { email: `nobody-${run}@${emailDomain}`, password: "x" } })).json?.detail);
  const ok = await call("POST", "/v1/auth/login", { body: { email: A.email, password: PW } });
  check("auth", "correct password signs in (200)", ok.status === 200 && ok.json?.access_token, ok.status);
  // refresh rotation and reuse detection
  const r1 = await call("POST", "/v1/auth/refresh", { body: { refresh_token: ok.json.refresh_token } });
  check("auth", "refresh token rotates (200)", r1.status === 200 && r1.json?.refresh_token !== ok.json.refresh_token, r1.status);
  const reuse = await call("POST", "/v1/auth/refresh", { body: { refresh_token: ok.json.refresh_token } });
  check("auth", "reused refresh token rejected (401)", reuse.status === 401, reuse.status);
  const after = await call("POST", "/v1/auth/refresh", { body: { refresh_token: r1.json.refresh_token } });
  check("auth", "token reuse ends the whole session", after.status === 401, after.status);
  // logout revokes the access token's session
  const s = await call("POST", "/v1/auth/login", { body: { email: A.email, password: PW } });
  check("auth", "logout (204)", (await call("POST", "/v1/auth/logout", { token: s.json.access_token })).status === 204);
  check("auth", "access token rejected after logout (401)", (await call("GET", "/v1/me", { token: s.json.access_token })).status === 401);
  check("auth", "other sessions unaffected by logout", (await call("GET", "/v1/me", { token: A.token })).status === 200);
});

await area("rate-limit", async () => {
  const email = `limit-${run}@${emailDomain}`;
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call("POST", "/v1/auth/login", { body: { email, password: "wrong" } })).status);
  check("rate-limit", "repeated failed logins are throttled (429 within 8 attempts)", codes.includes(429), codes.join(","));
});

await area("jwt", async () => {
  const [h, p, sig] = A.token.split(".");
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  check("jwt", "no token rejected (401)", (await call("GET", "/v1/me")).status === 401);
  check("jwt", "garbage token rejected (401)", (await call("GET", "/v1/me", { token: "not.a.token" })).status === 401);
  check("jwt", "tampered signature rejected (401)",
    (await call("GET", "/v1/me", { token: `${h}.${p}.${sig.slice(0, -4)}AAAA` })).status === 401);
  const forged = { ...payload, sub: B.userId };
  check("jwt", "payload swapped to another user, original signature, rejected (401)",
    (await call("GET", "/v1/me", { token: `${h}.${b64(forged)}.${sig}` })).status === 401);
  const foreignKey = randomBytes(48).toString("hex");
  const fh = b64({ alg: "HS256", typ: "JWT" });
  const fp = b64(forged);
  const fs = createHmac("sha256", foreignKey).update(`${fh}.${fp}`).digest("base64url");
  check("jwt", "token signed with a foreign secret rejected (401)", (await call("GET", "/v1/me", { token: `${fh}.${fp}.${fs}` })).status === 401);
  // The property is "never accepted". The API answers 401; Vercel's edge may reject an
  // unsigned token first with another 4xx, which is equally a refusal. Record which it was.
  const none = await call("GET", "/v1/me", { token: `${b64({ alg: "none", typ: "JWT" })}.${fp}.` });
  check("jwt", "alg=none token never accepted (4xx, no user data)",
    none.status >= 400 && none.status < 500 && !/"email"/.test(none.text), `status ${none.status}`);
  note("jwt", "alg=none rejection status", `${none.status} ${none.status === 401 ? "(API)" : "(rejected before or outside the API auth check)"}`);
  const expired = { ...payload, exp: Math.floor(Date.now() / 1000) - 60 };
  check("jwt", "expired-claim token with original signature rejected (401)",
    (await call("GET", "/v1/me", { token: `${h}.${b64(expired)}.${sig}` })).status === 401);
  check("jwt", "access token is short-lived (<= 15 minutes)", payload.exp - payload.iat <= 15 * 60, payload.exp - payload.iat);
  check("jwt", "issuer and audience claims present", payload.iss && payload.aud, `${payload.iss}/${payload.aud}`);
});

// ---------- workspace setup for scheduling ----------
let svc, svcB;
await area("setup", async () => {
  const set = await call("PATCH", o(A, "/settings"), { token: A.token, body: { timezone: "Asia/Kolkata", booking_capacity: 1 } });
  check("setup", "workspace settings: timezone Asia/Kolkata (+05:30), capacity 1", set.status === 200 && set.json?.timezone === "Asia/Kolkata", set.status);
  const intervals = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "09:00:00", closes_at: "17:00:00" }));
  check("setup", "office hours set", (await call("PUT", o(A, "/office-hours"), { token: A.token, body: { intervals } })).status === 200);
  const s = await call("POST", o(A, "/services"), { token: A.token, body: { name: `${LABEL} Consultation`, duration_min: 30, buffer_min: 0 } });
  check("setup", "service created (201)", s.status === 201, s.status);
  svc = s.json;
  await call("PUT", o(B, "/office-hours"), { token: B.token, body: { intervals } });
  svcB = (await call("POST", o(B, "/services"), { token: B.token, body: { name: `${LABEL} B Service`, duration_min: 30 } })).json;
});

// a date 3 days ahead in the workspace's zone (plain date is fine: the API resolves it locally)
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function slots(a, service, on, extra = "") {
  const r = await call("GET", o(a, `/availability?service_id=${service.id}&on=${on}${extra}`), { token: a.token });
  return r.json?.slots ?? [];
}
const book = (a, service, starts_at, token = a.token, name = "Synthetic Caller") =>
  call("POST", o(a, "/appointments"), { token, body: { service_id: service.id, starts_at, customer_name: name, customer_phone: "+447700900123" } });
const same = (x, y) => new Date(x).getTime() === new Date(y).getTime();

let appt;
await area("scheduling", async () => {
  const on = day(3);
  const free = await slots(A, svc, on);
  check("scheduling", "availability lists open slots", free.length >= 6, free.length);
  const avail = await call("GET", o(A, `/availability?service_id=${svc.id}&on=${on}`), { token: A.token });
  check("scheduling", "availability reports the workspace time zone", avail.json?.timezone === "Asia/Kolkata", avail.json?.timezone);
  check("scheduling", "first slot is 09:00 local = 03:30Z", new Date(free[0]).toISOString().endsWith("T03:30:00.000Z"), free[0]);
  // timezone: a naive local time is interpreted in the workspace zone
  const naive = await book(A, svc, `${on}T10:00:00`);
  check("scheduling", "naive local time booked in workspace zone (10:00 IST = 04:30Z)",
    naive.status === 201 && new Date(naive.json.starts_at).toISOString() === `${on}T04:30:00.000Z`, `${naive.status} ${naive.json?.starts_at}`);
  check("scheduling", "same instant given with explicit offset is refused as taken (409)", (await book(A, svc, `${on}T04:30:00Z`)).status === 409);
  appt = naive.json;
  check("scheduling", "booked slot disappears from availability", !(await slots(A, svc, on)).some((s) => same(s, appt.starts_at)));
  check("scheduling", "outside opening hours refused (409)", (await book(A, svc, `${on}T20:00:00`)).status === 409);
  check("scheduling", "past time refused (409)", (await book(A, svc, `${day(-1)}T10:00:00`)).status === 409);
  check("scheduling", "beyond the 60-day horizon refused (409)", (await book(A, svc, `${day(75)}T10:00:00`)).status === 409);
  check("scheduling", "off-quarter-hour start refused (409)", (await book(A, svc, `${on}T11:07:00`)).status === 409);
  check("scheduling", "invalid phone refused", (await call("POST", o(A, "/appointments"), {
    token: A.token, body: { service_id: svc.id, starts_at: `${on}T12:00:00`, customer_name: "X", customer_phone: "123" },
  })).status >= 400);

  // concurrency: 8 simultaneous bookings for one free slot -> exactly one wins
  const target = `${on}T13:00:00`;
  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => book(A, svc, target, A.token, `Racer ${i}`)));
  const codes = race.map((r) => r.status);
  check("concurrency", "8 parallel bookings of one slot: exactly one 201", codes.filter((c) => c === 201).length === 1, codes.join(","));
  check("concurrency", "the other 7 get 409, none 5xx", codes.filter((c) => c === 409).length === 7, codes.join(","));
  const listed = (await call("GET", o(A, `/appointments?from=${on}T00:00:00Z&to=${day(4)}T23:59:00Z`), { token: A.token })).json ?? [];
  check("concurrency", "exactly one booking stored for the raced slot", listed.filter((x) => same(x.starts_at, `${on}T07:30:00Z`)).length === 1,
    listed.map((x) => x.starts_at).join(","));

  // rescheduling
  const moved = await call("POST", o(A, `/appointments/${appt.id}/reschedule`), { token: A.token, body: { starts_at: `${on}T14:00:00` } });
  check("rescheduling", "reschedule to a free slot (200)", moved.status === 200 && new Date(moved.json.starts_at).toISOString() === `${on}T08:30:00.000Z`, moved.status);
  check("rescheduling", "old slot is free again", (await slots(A, svc, on)).some((s) => same(s, `${on}T04:30:00Z`)));
  check("rescheduling", "reschedule into a taken slot refused (409)",
    (await call("POST", o(A, `/appointments/${appt.id}/reschedule`), { token: A.token, body: { starts_at: target } })).status === 409);
  const x = (await book(A, svc, `${on}T15:00:00`)).json;
  const y = (await book(A, svc, `${on}T15:30:00`)).json;
  const pair = await Promise.all([x, y].map((a) => call("POST", o(A, `/appointments/${a.id}/reschedule`), { token: A.token, body: { starts_at: `${on}T16:00:00` } })));
  check("concurrency", "two parallel reschedules into one slot: one 200, one 409",
    pair.map((r) => r.status).sort().join(",") === "200,409", pair.map((r) => r.status).join(","));
  check("rescheduling", "availability excluding the booking being moved offers its own slot",
    (await slots(A, svc, on, `&appointment_id=${appt.id}`)).some((s) => same(s, `${on}T08:30:00Z`)));

  // cancellation
  const c1 = await call("POST", o(A, `/appointments/${appt.id}/cancel`), { token: A.token });
  check("cancellation", "cancel (200, status cancelled)", c1.status === 200 && c1.json?.status === "cancelled", c1.status);
  const c2 = await call("POST", o(A, `/appointments/${appt.id}/cancel`), { token: A.token });
  check("cancellation", "cancel is idempotent (200, still cancelled, timestamp unchanged)",
    c2.status === 200 && c2.json?.cancelled_at === c1.json?.cancelled_at, c2.status);
  check("cancellation", "cancelled booking cannot be rescheduled (409)",
    (await call("POST", o(A, `/appointments/${appt.id}/reschedule`), { token: A.token, body: { starts_at: `${on}T10:00:00` } })).status === 409);
  check("cancellation", "cancelled slot can be booked again (201)", (await book(A, svc, `${on}T14:00:00`)).status === 201);
  const withCancelled = (await call("GET", o(A, `/appointments?from=${on}T00:00:00Z&include_cancelled=true`), { token: A.token })).json ?? [];
  check("cancellation", "cancelled booking kept in history", withCancelled.some((a) => a.id === appt.id && a.status === "cancelled"));
  note("idempotency", "staff booking API has no idempotency key",
    "POST /appointments accepts no key; duplicate submissions are prevented by slot capacity (verified above). Keys exist only on the AI receptionist path.");
  note("timezone", "DST transitions not exercised on the hosted run",
    "no DST change for the test zones falls inside the 60-day booking horizon from today; covered by unit tests only.");
});

await area("tenant-isolation", async () => {
  const on = day(3);
  for (const [name, path] of [
    ["organisation", ""], ["members", "/members"], ["services", "/services"], ["appointments", "/appointments"],
    ["office hours", "/office-hours"], ["settings", "/settings"], ["audit log", "/audit-logs"], ["cases", "/cases"],
    ["business profile", "/business-profile"], ["export", "/export"],
  ]) {
    const r = await call("GET", o(A, path), { token: B.token });
    check("tenant-isolation", `tenant B cannot read tenant A's ${name}`, [403, 404].includes(r.status), r.status);
  }
  const svcRead = await call("GET", o(A, `/services/${svc.id}`), { token: B.token });
  check("tenant-isolation", "tenant B cannot read A's service by ID", [403, 404].includes(svcRead.status), svcRead.status);
  check("tenant-isolation", "tenant B cannot book into A's workspace", [403, 404].includes((await book(A, svc, `${on}T11:00:00`, B.token)).status));
  const aAppt = (await book(A, svc, `${on}T11:30:00`)).json;
  check("tenant-isolation", "A's appointment ID via B's own workspace path: 404",
    (await call("POST", o(B, `/appointments/${aAppt.id}/cancel`), { token: B.token })).status === 404);
  check("tenant-isolation", "A's service ID via B's own workspace path: 404",
    (await call("GET", o(B, `/availability?service_id=${svc.id}&on=${on}`), { token: B.token })).status === 404);
  check("tenant-isolation", "A's service cannot be booked from B's workspace (404)",
    (await call("POST", o(B, "/appointments"), { token: B.token, body: { service_id: svc.id, starts_at: `${on}T12:00:00`, customer_name: "X", customer_phone: "+447700900123" } })).status === 404);
  const still = (await call("GET", o(A, `/appointments?from=${on}T00:00:00Z`), { token: A.token })).json ?? [];
  check("tenant-isolation", "A's appointment untouched by B's attempts", still.some((a) => a.id === aAppt.id && a.status === "booked"));
  const bList = (await call("GET", o(B, `/appointments?from=${on}T00:00:00Z`), { token: B.token })).json ?? [];
  check("tenant-isolation", "B's appointment list contains none of A's", !bList.some((a) => a.service_id === svc.id));
  check("tenant-isolation", "B's workspace list shows only B", (await call("GET", "/v1/me/organizations", { token: B.token })).json?.length === 1);
  check("tenant-isolation", "B cannot invite into A", [403, 404].includes((await call("POST", o(A, "/invitations"), { token: B.token, body: { email: `x-${run}@${emailDomain}` } })).status));
  check("tenant-isolation", "B's own workspace still works", (await call("GET", o(B, "/services"), { token: B.token })).json?.some((s) => s.id === svcB?.id));
});

await area("rbac", async () => {
  async function member(label, role) {
    const m = await signup(label, `${LABEL} ${label} own ${run}`);
    const inv = await call("POST", o(A, "/invitations"), { token: A.token, body: { email: m.email, role } });
    if (!inv.json?.token) {
      check("rbac", `invitation token available to join ${role}`, false, "API does not expose invitation tokens; RBAC needs an e-mail-less join path");
      return null;
    }
    const acc = await call("POST", "/v1/invitations/accept", { token: m.token, body: { token: inv.json.token } });
    check("rbac", `${role} joins workspace A`, acc.status === 200 && acc.json?.role === role, acc.status);
    m.orgId = A.orgId;
    return m;
  }
  viewer = await member("viewer", "viewer");
  staff = await member("staff", "staff");
  if (!viewer || !staff) return;
  const on = day(4);
  check("rbac", "viewer can read services", (await call("GET", o(A, "/services"), { token: viewer.token })).status === 200);
  check("rbac", "viewer can read appointments", (await call("GET", o(A, "/appointments"), { token: viewer.token })).status === 200);
  check("rbac", "viewer cannot book (403)", (await book(A, svc, `${on}T10:00:00`, viewer.token)).status === 403);
  check("rbac", "viewer cannot change office hours (403)", (await call("PUT", o(A, "/office-hours"), { token: viewer.token, body: { intervals: [] } })).status === 403);
  check("rbac", "viewer cannot read the audit log (403)", (await call("GET", o(A, "/audit-logs"), { token: viewer.token })).status === 403);
  const sb = await book(A, svc, `${on}T10:00:00`, staff.token);
  check("rbac", "staff can book (201)", sb.status === 201, sb.status);
  check("rbac", "staff can cancel (200)", (await call("POST", o(A, `/appointments/${sb.json?.id}/cancel`), { token: staff.token })).status === 200);
  check("rbac", "staff cannot create services (403)", (await call("POST", o(A, "/services"), { token: staff.token, body: { name: "x", duration_min: 30 } })).status === 403);
  check("rbac", "staff cannot change settings (403)", (await call("PATCH", o(A, "/settings"), { token: staff.token, body: { booking_capacity: 5 } })).status === 403);
  check("rbac", "staff cannot invite members (403)", (await call("POST", o(A, "/invitations"), { token: staff.token, body: { email: `y-${run}@${emailDomain}` } })).status === 403);
  check("rbac", "staff cannot promote themselves (403)",
    (await call("PATCH", o(A, `/members/${staff.userId}`), { token: staff.token, body: { role: "owner" } })).status === 403);
  check("rbac", "staff cannot export workspace data (403)", (await call("GET", o(A, "/export"), { token: staff.token })).status === 403);
  check("rbac", "staff cannot delete the workspace (403)", (await call("DELETE", o(A), { token: staff.token, body: { password: PW } })).status >= 400);
  check("rbac", "owner sees both members", ((await call("GET", o(A, "/members"), { token: A.token })).json ?? []).length === 3);
  check("rbac", "audit log records staff booking", ((await call("GET", o(A, "/audit-logs"), { token: A.token })).json ?? []).some((e) => e.action === "appointment.created"));
});

await area("security", async () => {
  const r = await call("GET", "/healthz");
  check("security", "X-Content-Type-Options: nosniff", r.headers.get("x-content-type-options") === "nosniff");
  check("security", "X-Frame-Options: DENY", r.headers.get("x-frame-options") === "DENY");
  check("security", "Cache-Control: no-store", r.headers.get("cache-control") === "no-store");
  check("security", "Referrer-Policy: no-referrer", r.headers.get("referrer-policy") === "no-referrer");
  check("security", "X-Request-ID issued", Boolean(r.headers.get("x-request-id")));
  const pre = await call("OPTIONS", "/v1/me", { headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
  check("security", "CORS does not allow an arbitrary origin", pre.headers.get("access-control-allow-origin") !== "https://evil.example" && pre.headers.get("access-control-allow-origin") !== "*",
    pre.headers.get("access-control-allow-origin"));
  const nf = await call("GET", o(A, `/services/00000000-0000-0000-0000-000000000000`), { token: A.token });
  check("security", "not-found error body is minimal", nf.status === 404 && !/Traceback|sqlalchemy|psycopg|postgres/i.test(nf.text), nf.text);
  const bad = await call("POST", o(A, "/appointments"), { token: A.token, body: { service_id: "nope" } });
  check("security", "validation error leaks no internals", bad.status === 422 && !/Traceback|sqlalchemy|psycopg/i.test(bad.text));
  const all = JSON.stringify(results);
  check("security", "no credential-like strings in any response captured", !/postgres(ql)?:\/\/|neondb_owner|voxera_owner/.test(all));
  note("config", "HSTS header", r.headers.get("strict-transport-security") ? "present" : "absent: runtime env is not 'production' (VOXERA_ENV unset)");
  const docs = await call("GET", "/docs");
  note("config", "/docs (OpenAPI UI)", docs.status === 200 ? "exposed: runtime env is not 'production'" : `not exposed (${docs.status})`);
});

await area("reliability", async () => {
  check("reliability", "healthz reports this commit (short SHA)", (await call("GET", "/healthz")).json?.commit === SHA.slice(0, 7));
  check("reliability", "readyz 200", (await call("GET", "/readyz")).status === 200);
  const burst = await Promise.all(Array.from({ length: 20 }, () => call("GET", o(A, "/services"), { token: A.token })));
  check("reliability", "20 concurrent reads succeed without 5xx", burst.every((r) => r.status === 200), burst.map((r) => r.status).join(","));
  if (finalIdentity) {
    check("reliability", "target identity unchanged after the writes", await finalIdentity());
  } else {
    const id2 = await fetch(API + "/rc1-identity", { cache: "no-store" }).then((r) => r.json());
    check("reliability", "isolation identity unchanged after the writes", id2.environment === "staging" && id2.schema === identity.schema && id2.superuser === false);
  }
});

// ---------- clean-up (members first; owners last) ----------
await area("cleanup", async () => {
  for (const a of [...accounts].reverse()) {
    let r = await call("DELETE", "/v1/me", { token: a.token, body: { password: PW } });
    if (r.status === 401) {
      // The sign-up token has expired or its session was revoked: sign in again and retry.
      const fresh = await call("POST", "/v1/auth/login", { body: { email: a.email, password: PW } });
      if (fresh.json?.access_token) r = await call("DELETE", "/v1/me", { token: fresh.json.access_token, body: { password: PW } });
    }
    check("cleanup", `synthetic account ${a.label} deleted`, r.status === 204, r.status);
  }
  if (proveCleanup) {
    for (const a of accounts) {
      const r = await call("POST", "/v1/auth/login", { body: { email: a.email, password: PW } });
      check("cleanup", `deleted account ${a.label} can no longer sign in (401)`, r.status === 401, r.status);
    }
  }
});

const failed = results.filter((r) => r.ok === false);
writeFileSync(OUT, JSON.stringify({ api: API, web: WEB, commit: SHA, run, identity, results }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} notes`);
return failed.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [api, web, sha, out = "rc1-acceptance.json"] = process.argv.slice(2);
  const identity = await verifyRc1(api, web, sha); // throws (no writes) unless isolation is proven
  process.exit((await runAcceptance({ api, web, sha, identity, out })) ? 1 : 0);
}
