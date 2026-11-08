# Phase 2: shared rate limiter (Postgres)

- **Status:** implemented and tested on a branch, against disposable databases only.
- **Production:** not migrated. This needs the owner's approval, using the migration proposal below.
- **Branch:** `claude/phase2-rate-limiter`. Migration `0010`.

## Problem

Login attempts were limited to 5 per minute for each email and address pair, counted in each
process's memory (`app/ratelimit.py`). On Vercel every warm instance is a separate process, so:
- each instance kept its own count, and an attacker whose requests landed on *n* instances got
  *n* × 5 attempts a minute;
- a cold start reset the count.

## Design

| Concern | How it is handled |
|---|---|
| **Shared state** | Counts live in one table, `rate_limit_hits`, so every instance and region counts against the same row |
| **Atomic counting** | One call to the `rate_limit_hit(bucket, window)` function does a single `INSERT … ON CONFLICT DO UPDATE SET hits = hits + 1 RETURNING hits`. The row lock serialises simultaneous requests, so each gets a distinct count and exactly *limit* requests pass |
| **Algorithm** | Sliding-window counter: estimate = previous window × (1 − elapsed fraction) + current window. This smooths the burst a fixed window allows at its boundary. The current window is counted exactly; the previous one is weighted |
| **Clock** | The database clock (`clock_timestamp()`) picks the window, so instances whose clocks disagree still share windows |
| **Expiry** | Each row expires two windows after it starts. Every call deletes up to 50 expired rows (`FOR UPDATE SKIP LOCKED`, so it never waits on another request). No scheduled job is needed |
| **Refused attempts** | They still count, so a caller who keeps trying stays limited |
| **Privacy** | A bucket is an HMAC-SHA256 of the limiter's name, its limit, its window and the key (email and address). The key is derived from the JWT secret with a fixed label. No email or IP address is stored |
| **Least privilege** | The runtime role has **no** access to the table. It may only `EXECUTE` the function. The function is `SECURITY DEFINER` with a fixed `search_path`, and validates the bucket (`^[a-z0-9_:-]{1,64}$`) and the window (1–86,400 s) |
| **Fails closed** | If the store cannot be reached, `check` raises `LimiterUnavailable`, and login answers **503 "Sign-in is temporarily unavailable"**, never an uncounted attempt. Login needs the same database anyway, so this adds no new way to fail |
| **Its own transaction** | The hit commits on its own connection before the password check. A failed login (whose request session is rolled back) still counts |
| **Retry hint** | A 429 response carries `Retry-After`: the seconds until the estimate falls back within the limit |
| **Rollback without a revert** | Setting `VOXERA_RATE_LIMIT_BACKEND=memory` restores the previous in-process limiter. The table can stay |

Cost: one short round trip to Postgres per login attempt, on a request that already makes several.

Not changed: what is limited (each email and address pair) and how much (5 a minute).

## Tests (`tests/test_ratelimit.py`, 18 tests; full API suite 298 passed)

- **Concurrency.** 20 simultaneous attempts through two engines (two "instances" with separate pools) against a limit of 5: **exactly 5 allowed**.
- **Counting.** Counts are sequential (1, 2, 3, 4). Keys and limiters do not share counts.
- **Previous window.** A previous window still counts while it overlaps. Decision and `Retry-After` arithmetic are checked at the boundaries.
- **Expiry.** Expired windows are removed; fresh ones are kept.
- **Access control.** The runtime role cannot `SELECT`, `INSERT` or `DELETE` on the table. The function rejects bad buckets and windows.
- **Privacy.** After a login attempt, only a 64-character digest is stored.
- **Responses.** Login 429 carries `Retry-After`. An unreachable store gives **503**, and no token is issued.
- **Rollback and migration.** The `memory` setting gives the old limiter. Migration 0010 downgrades to 0009 and upgrades again.
- **Release verifier.** `scripts/verify_release.py` checks for revision 0010 or later:
  - the table exists;
  - the function is security definer;
  - the runtime role can call the function;
  - the runtime role has no table privileges.

## Migration proposal (needs owner approval)

| | |
|---|---|
| Change | Adds the table `rate_limit_hits` and the function `rate_limit_hit`. Adds grants: `REVOKE ALL` on the table and `EXECUTE` on the function for `voxera_app`. No existing table is touched |
| Data | None migrated. The table starts empty |
| Lock impact | `CREATE TABLE` and `CREATE FUNCTION` only, with no lock on existing tables. Runs in well under a second |
| Order | **Migrate first, then merge.** The build preflight refuses to deploy code whose migration head is ahead of the database, so merging first only blocks the deploy, and production stays on the current deployment |
| Steps | 1. Neon backup branch of production. 2. `db-migrate` workflow to `0010` (production environment approval). 3. `scripts/verify_release.py --env production --expect 0010 --baseline …`. 4. Merge the PR. 5. Confirm the deployment preflight says "schema at 0010". 6. Run a login smoke test: five wrong passwords, then 429 with `Retry-After` |
| Rollback, behaviour | Set `VOXERA_RATE_LIMIT_BACKEND=memory` and redeploy. This is the old behaviour, with no schema change |
| Rollback, code | Revert the merge. The table and function are unused but harmless |
| Rollback, schema | `alembic downgrade 0009` drops both. This is tested; it is only needed if the table itself is a problem |

## Open items

1. **Which address does the API see on Vercel?** `client_meta` uses `request.client.host`. If that is a proxy address rather than the caller's, every login shares one address, and the limit is effectively per email. Someone could then hold another person's sign-in at 429 for a minute; that risk exists today too. Check this on a preview deployment before relying on the per-address part, then read the platform's forwarded-for header if needed.
2. **Other endpoints.** The same limiter can protect sign-up, refresh, invitation acceptance and the live endpoints (per workspace). Each is a one-line `make_limiter(...)` plus a test. They are not added here, to keep this change small.
