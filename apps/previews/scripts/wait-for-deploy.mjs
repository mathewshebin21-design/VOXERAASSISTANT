// Waits until the staging API reports the given commit and is ready, and the web app answers.
// Usage: node scripts/wait-for-deploy.mjs <api-url> <web-url> <short-sha>
const [api, web, sha] = process.argv.slice(2);
const deadline = Date.now() + 15 * 60_000;
const get = async (u) => { try { const r = await fetch(u, { cache: "no-store" }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; } };
for (;;) {
  const h = await get(`${api}/healthz`);
  let commit = null;
  try { commit = JSON.parse(h.body).commit; } catch { /* not JSON yet */ }
  const ready = await get(`${api}/readyz`);
  const w = await get(`${web}/flow/enter`);
  console.log(`api commit=${commit} ready=${ready.status} web=${w.status}`);
  if (commit === sha && ready.status === 200 && w.status === 200) break;
  if (Date.now() > deadline) {
    console.error(`Timed out waiting for ${sha}. Last readyz: ${ready.body.slice(0, 300)}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log("staging is serving this commit");
