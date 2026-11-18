# Phase 11 — picomatch advisory: security triage and release disposition

**Status:** OPEN / release blocked. **Scope:** `apps/previews` dependency graph. **Advisory:** [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (ReDoS through single-branch repeated extglobs).

## Evidence

- [Frontend CI 44236940576](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44236940576) passed install, lint, typecheck, unit tests, script tests, build, browser E2E and accessibility, but failed the final `npm audit --audit-level=high` enforcement.
- [API CI 44236940596](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44236940596) and [integration CI 44236940547](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44236940547) passed on the same commit `a6edc61`.
- Audit reports **20 high-severity findings**, many cascading from a single `picomatch` advisory. Affected dependency paths include `vite`, `vitest`, `tinyglobby`, `micromatch`, `fast-glob`, `chokidar`, `tailwindcss` and ESLint-related tooling. **Twenty findings do not necessarily mean twenty independent exploitable defects.**
- The frontend package declares `next`, `react`, and other runtime dependencies separately from `vite`, `vitest`, `tailwindcss` and ESLint in `devDependencies`. **This is not proof that vulnerable code cannot ship or run in production**: transitive production paths and build artifacts have not been independently enumerated.
- The advisory has not yielded a verified compatible fixed release in the CI audit output. `npm audit fix --force` proposed incompatible changes and previously failed; it is not an approved remedy.

## Threat model and open evidence

The reported issue requires attacker-influenced glob pattern evaluation in vulnerable `picomatch` code. A remote denial-of-service path would require evidence that an untrusted request, imported file, webhook, API payload, or tenant-supplied configuration can reach such matching at runtime. **No such path has yet been demonstrated, but absence of evidence is not proof of safety.**

Required verification before any exception is considered:

1. Capture `npm audit --json` and `npm ls picomatch --all` in isolated CI; retain versions and paths as artifacts, with no secrets.
2. Run `npm audit --omit=dev --audit-level=high` **as a diagnostic only**; retain the existing full audit gate. A clean production-only audit does not automatically approve a release.
3. Inspect `apps/previews` runtime routes, imported modules, user-supplied file/config handling, server-side matching, and output bundles for vulnerable matcher use. Record exact source paths and test cases.
4. Identify upstream patched releases or a separately reviewed replacement, update the lockfile without unrelated breaking upgrades, then rerun all security and functional CI on one commit.
5. If no patch exists and launch is urgent, obtain a documented, time-limited security risk acceptance from the owner with compensating controls, scope, monitoring, expiry and remediation owner. This **does not automatically waive the existing CI gate**; any release-policy change needs separate explicit approval.

## Non-negotiable constraints

Do not suppress the advisory, disable the audit, declare the issue non-exploitable without evidence, merge draft PR #63, enable live billing, deploy production, or provision billable services without explicit approval. Keep synthetic billing and isolated staging boundaries.

## Collected dependency evidence — run 44238963895

Artifact [dependency-security-evidence](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44238963895) (artifact ID `14398782348`, retained 14 days) contains `audit-full.json`, `audit-production.json`, and `picomatch-tree.json`. Inspected the downloaded JSON files: **full audit = 20 high, 0 critical; `npm audit --omit=dev` = 0 vulnerabilities across all severity levels**. The tree includes `tailwindcss@3.4.19` -> `chokidar@3.6.0` -> `anymatch@3.1.3` -> `picomatch@2.3.2`, among other development tooling paths. This is evidence of a clean production-only npm dependency audit **for this lockfile**, not proof that deployed bundles or dynamic runtime paths are safe. Keep full audit gate failing until fixed or explicitly authorized via release policy.

## Targeted source review (2026-11-18)

Reviewed `apps/previews/next.config.mjs`, `src/app/api/v1/[...path]/route.ts` and `src/lib/server/session.ts`. The Next configuration sets strict React mode and disables the powered-by header; it does not configure glob matching. The API proxy constructs its permitted subpath from URL segments, checks it against a fixed regular-expression allowlist, enforces CSRF checks, and forwards to the backend; no `picomatch` import or user-supplied glob evaluation appears in that handler. The session module handles cookie tokens, refresh deduplication and CSRF checks, and likewise contains no glob matcher invocation. **This is a bounded source review of these files only**. It does not constitute a repository-wide source scan, transitive runtime analysis, production bundle inspection, or proof of non-exploitability. The full audit gate remains blocking.

## Automated source scan evidence — run 44254381952

The [CI evidence artifact](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44254381952) (artifact ID `14404794330`) was downloaded and inspected. `runtime-source-scan.json` reports **162 application source files scanned, zero matching lines** for the configured glob matcher patterns. `audit-production.json` reports **zero vulnerabilities** (all severity levels). This is a static text-pattern scan, not a complete data-flow analysis: indirect dynamic imports, bundled transitive code, other glob libraries, or runtime-generated code are outside its proof boundary. Continue to block release under the full-audit policy until an upstream fix or explicitly authorized release decision.

## Compiled Next.js bundle inspection — run 44254912052

Downloaded and inspected [compiled-bundle-security-evidence](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/44254912052), artifact ID `14405876284`. `compiled-bundle-scan.json` reports `buildPresent: true`, **276 compiled JS bundles scanned** under `.next/server` and `.next/static`, **zero signature matches** for the configured matcher names. The scan is heuristic: minification, inlining, renaming, and runtime-loaded dependencies can evade name-based detection. The production-only npm audit and 162-file application-source scan also report zero matches/findings, but the **full npm audit continues to report 20 high vulnerabilities** and remains a release blocker. No waiver, production deployment, or live payment enablement is authorized by these diagnostics.
