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
