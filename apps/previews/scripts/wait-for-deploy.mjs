// Waits until the staging API and web app are both serving exactly the expected commit.
// Usage: node scripts/wait-for-deploy.mjs <api-url> <web-url> <full-40-char-sha>
//
// Readiness evidence is only a JSON identity response naming the expected full commit:
//   API: GET <api>/readyz → 200, and GET <api>/staging-identity → JSON {commit: <sha>}
//   web: GET <web>/api/staging-identity → JSON {commit: <sha>}
// Anything else is "not ready", with a reason: Vercel's building/error placeholder pages
// (served as HTML, often with status 200), login or deployment-protection pages (401/403,
// or a redirect to vercel.com), server errors, timeouts, non-JSON bodies and other commits.
// This step only waits; the isolation gate (staging-isolation.mjs) still runs afterwards.
import { pathToFileURL } from "node:url";

const SHA = /^[a-f0-9]{40}$/;

// Classifies one HTTP probe. Returns { ok, reason, json }.
export async function probe(url, request = fetch) {
  let response;
  try {
    response = await request(url, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { ok: false, reason: `unreachable (${String(e?.message ?? e).slice(0, 120)})` };
  }
  const status = response.status;
  if (status >= 300 && status < 400) {
    return { ok: false, reason: `redirect ${status} to ${response.headers.get("location") ?? "?"} (login or deployment-protection page)` };
  }
  if (status === 401 || status === 403) return { ok: false, reason: `${status}: login or deployment-protection page` };
  const type = response.headers.get("content-type") ?? "";
  const body = await response.text().catch(() => "");
  const looksHtml = /^\s*</.test(body) || type.includes("text/html");
  if (looksHtml) {
    const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
    return { ok: false, reason: `HTTP ${status} HTML page${title ? ` "${title}"` : ""} (Vercel building, error or protection placeholder), not an identity response` };
  }
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  if (!type.includes("application/json")) return { ok: false, reason: `HTTP 200 but content-type "${type || "none"}", not JSON` };
  try {
    return { ok: true, reason: "ok", json: JSON.parse(body) };
  } catch {
    return { ok: false, reason: "HTTP 200 JSON content-type but the body is not valid JSON" };
  }
}

// One readiness check of both deployments. Returns { ready, api, web } with a reason for each.
export async function checkOnce(api, web, sha, request = fetch) {
  const ready = await probe(`${api}/readyz`, request);
  const apiId = await probe(`${api}/staging-identity`, request);
  const webId = await probe(`${web}/api/staging-identity`, request);
  const commitOf = (p, label) => {
    if (!p.ok) return p.reason;
    const commit = p.json?.commit;
    if (commit === sha) return "ok";
    return `${label} serves commit ${commit ?? "(none)"}, expected ${sha}`;
  };
  const apiState = !ready.ok ? `readyz: ${ready.reason}` : commitOf(apiId, "API");
  const webState = commitOf(webId, "web");
  return { ready: apiState === "ok" && webState === "ok", api: apiState, web: webState };
}

// Polls until both are ready or the time limit passes. Clock and sleep are injectable for tests.
export async function waitForStaging(api, web, sha, {
  request = fetch, timeoutMs = 15 * 60_000, intervalMs = 15_000,
  now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log,
} = {}) {
  if (!SHA.test(sha ?? "")) throw new Error("A full 40-character commit SHA is required");
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let last;
  for (;;) {
    attempt += 1;
    last = await checkOnce(api, web, sha, request);
    log(`[${attempt}] api: ${last.api} | web: ${last.web}`);
    if (last.ready) return { attempts: attempt };
    if (now() + intervalMs > deadline) {
      throw new Error(`Timed out after ${attempt} checks (${Math.round(timeoutMs / 1000)}s) waiting for ${sha}.\n  last API state: ${last.api}\n  last web state: ${last.web}`);
    }
    await sleep(intervalMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [api, web, sha] = process.argv.slice(2);
  try {
    const { attempts } = await waitForStaging(api, web, sha);
    console.log(`staging API and web are both serving ${sha} (after ${attempts} check${attempts === 1 ? "" : "s"})`);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
