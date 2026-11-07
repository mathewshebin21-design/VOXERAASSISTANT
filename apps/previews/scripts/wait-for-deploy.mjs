// Waits until the API reports the given commit and is ready, and the web app answers.
// Usage: node scripts/wait-for-deploy.mjs <api-url> <web-url> <short-sha> [web-identity-path full-sha]
// With the optional pair, also waits until <web-url><web-identity-path> reports the full commit,
// so a gate that checks both deployments never races a web build that is still in progress.
const [api, web, sha, webIdentity, fullSha] = process.argv.slice(2);
const deadline = Date.now() + 15 * 60_000;
const get = async (u) => { try { const r = await fetch(u, { cache: "no-store" }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; } };
const field = (body, key) => { try { return JSON.parse(body)[key]; } catch { return null; } };
for (;;) {
  const h = await get(`${api}/healthz`);
  const commit = field(h.body, "commit");
  const ready = await get(`${api}/readyz`);
  const w = await get(`${web}/flow/enter`);
  let webCommit = null;
  if (webIdentity) webCommit = field((await get(`${web}${webIdentity}`)).body, "commit");
  console.log(`api commit=${commit} ready=${ready.status} web=${w.status}${webIdentity ? ` web commit=${webCommit?.slice(0, 7)}` : ""}`);
  if (commit === sha && ready.status === 200 && w.status === 200 && (!webIdentity || webCommit === fullSha)) break;
  if (Date.now() > deadline) {
    console.error(`Timed out waiting for ${sha}. Last readyz: ${ready.body.slice(0, 300)}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log("deployments are serving this commit");
