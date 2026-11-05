# Web dependency security review — 5 November 2026

The existing npm lock reported 11 advisory entries: 7 moderate, 1 high and
3 critical. This was discovered in release CI; green functional checks did
not establish security acceptance. No compromise or production exploit test
is claimed.

The reviewed update keeps Next.js on major 15 and pins Next.js and its ESLint
configuration to 15.5.29. The image-optimization advisory lists 15.5.27 as
affected and 15.5.28 as patched; 15.5.29 also contains later security fixes.

- https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/vercel/next.js/releases/tag/v15.5.29

PostCSS is pinned to 8.5.23, including nested copies via the direct-dependency
override. This remains within major 8 and addresses the source-map file-read
advisories. The lint-tool minimatch override is restricted to
`@typescript-eslint/typescript-estree`, rather than replacing every consumer.

- https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp
- https://github.com/advisories/GHSA-g3hv-75wg-m249

Vitest moves to the patched 4.1.12 test toolchain. A patch-only update to
3.2.7 retained vulnerable nested tooling, so it was insufficient. Vitest is
a development dependency and its public UI server is not enabled by this app.
The change still requires the complete existing unit suite to pass unchanged.

- https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp
- https://github.com/vitest-dev/vitest/releases/tag/v4.1.12

## Reproducibility and checks

The lock was generated from explicit top-level pins in a disposable GitHub CI
workspace, with package scripts disabled and repository permissions limited to
read. The original lock was retained for comparison during resolution. Node 24
was used only for resolution after npm's earlier resolver failed with
`Cannot read properties of null (reading 'edgesOut')`; application CI remains
on Node 22. The temporary resolution workflow is removed from the final tree.

The previews workflow checks `npm audit --audit-level=high` alongside the
existing lint, typecheck, unit, build and browser checks. Audit output is a
time-stamped dependency-database observation, not proof that the application
has no security defects. Record full audit counts and exact CI commits in the
PR before release review.

## Operation and recovery

There is no database migration, credential rotation or paid provider change.
No production merge or deployment is authorized by these patches. Merging the
production branch can trigger Vercel builds and therefore retains the owner's
release gate. Roll back a development regression on its feature branch; any
production rollback must explicitly consider whether it reintroduces a known
vulnerable package. Do not downgrade production dependencies automatically.
