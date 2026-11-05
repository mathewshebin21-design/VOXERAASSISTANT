# Studio check reliability

The browser harness previously classified every result except `false` as a pass.
Two assertions return diagnostic strings on failure: a disabled Publish button
after a slow save, and horizontal overflow on mobile. Those strings produced a
PASS line and exit status 0 even while failure evidence was captured.

The shared result recorder now requires an explicit `true` to pass. False,
diagnostic strings, missing returns and exceptions fail the check, retain failure
evidence and make the process exit nonzero. Browser assertions, timeouts, autosave
behavior and the application are unchanged.

Run `node --test scripts/studio-checks.test.mjs` from `apps/previews`. The twelve
dependency-free regressions cover result classification, captured error evidence,
page errors and actual child-process exit codes. The previews workflow runs these
alongside the existing staging/readiness tests using `scripts/*.test.mjs`.

Run the existing `e2e-studio.mjs` suite against disposable CI PostgreSQL and fake
providers to reassess the application. A successful recorder regression does not
prove Studio browser acceptance. Previous green runs must not be used to dismiss
the intermittent save/publish problem without rerunning the corrected harness.

This change has no application runtime, authentication, database schema or tenant
permission effect. It does not authorize hosted writes, production deployment,
PR merges, real-provider calls or telephone testing.
