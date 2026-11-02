// Checks that staging is isolated from production, from the outside.
// Usage: node scripts/staging-isolation.mjs <staging-api-url> <staging-web-url>
const [api, web] = process.argv.slice(2);
const PRODUCTION_API = "https://voxera-api-two.vercel.app";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// 1. The staging API is ready, which it only is when its database is claimed for staging
//    (app/deploy_env.py refuses every request otherwise).
const ready = await fetch(`${api}/readyz`);
check("staging API is ready on a database claimed for staging", ready.status === 200, `HTTP ${ready.status}`);

// 2. The staging web app talks to the staging API, not production: an account created through it
//    exists on staging, and cannot sign in to production.
const email = `isolation-${Date.now().toString(36)}@e2e.example`;
const password = "correct horse battery staple";
const signup = await fetch(`${web}/api/session/signup`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-voxera-csrf": "1" },
  body: JSON.stringify({ email, password, full_name: "Isolation Check", organization_name: "Isolation Check" }),
});
check("sign-up through the staging web app works", signup.ok, `HTTP ${signup.status}`);
const onStaging = await fetch(`${api}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
check("that account exists in the staging API", onStaging.status === 200, `HTTP ${onStaging.status}`);
const onProduction = await fetch(`${PRODUCTION_API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
check("that account does not exist in production", onProduction.status === 401, `HTTP ${onProduction.status}`);

// Clean up the test account on staging.
if (onStaging.ok) {
  const { access_token: token } = await onStaging.json();
  const del = await fetch(`${api}/v1/me`, { method: "DELETE", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ password }) });
  check("test account removed from staging", del.status === 204, `HTTP ${del.status}`);
}
process.exit(results.every(Boolean) ? 0 : 1);
