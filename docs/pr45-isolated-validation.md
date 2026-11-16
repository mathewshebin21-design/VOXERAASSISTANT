# PR45 isolated hosted validation — 16 November 2026 (India)

## Authorization and target isolation

Owner-approved **non-production** branch within existing Neon staging project. Production schema migration, paid voice services, SIP, real telephone numbers, customer data and resource deletion remain outside this approval.

| Item | Verified value |
| --- | --- |
| Neon project | `blue-night-16595257` (`voxera-staging`) |
| Shared staging parent | `br-super-cake-za8v2xbj` |
| Isolated validation branch | `br-shy-math-zaczmtq5` |
| Validation name | `pr45-validation-0012-20261116` |
| Endpoint | `ep-falling-darkness-zaoogbut` |
| Database | `neondb` |
| Environment marker | `staging` |
| Fixed compute | min=max 0.25 CU; idle suspension 300 seconds |
| Migration application source | `102bf2cd13bdc8915503a7f0a59708f161f128e5` |
| Preview application commit | `2839e460003255edb084daa201a813ef5aa63ea8` |
| Latest hosted acceptance test commit | `060bbe8060b8c027ebde38017a1838a849f99b2a` |

Existing staging data was cloned, not production data. Neon usage may incur charges under the existing plan. No credentials, connection strings, secrets or customer rows are reproduced in this document.

## Verified migration and non-production deployment

- GitHub Actions [PR45 isolated migration run 43866923135](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43866923135): **success**, including target gate, baseline at `0011`, approved migration and post-migration checks for privileges, retained rows and isolation.
- Independent Neon query confirmed isolated schema `0012`, environment marker `staging`, and both `voice_policies` and `phone_numbers` tables.
- Independent queries confirmed shared staging **still `0011`** and production **still `0011`**. The migration did not touch either branch.
- Both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are sensitive branch-specific settings in the Vercel API Preview, restricted to `codex/uk-india-release-candidate-20261116`. The frontend `VOXERA_API_URL` is likewise scoped to this branch.
- [API Preview deployment `dpl_Fi3BrCMtwhzx5RXxfe8ACB8a2xiw`](https://vercel.com/ai-e399/voxera-api/Fi3BrCMtwhzx5RXxfe8ACB8a2xiw) became READY; its read-only build preflight confirmed staging schema `0012`. The outside-in API `/healthz` returned `2839e46`, and `/readyz` returned ready.
- [Frontend Preview deployment `dpl_GLuqJkxLq9ejqLGM1Tpx6RP2m2Po`](https://vercel.com/ai-e399/voxera-flow/GLuqJkxLq9ejqLGM1Tpx6RP2m2Po) became READY; its homepage loads and its branch-specific API upstream is configured.
- Later commits only to CI, test code and documentation require their own CI checks. The hosted application binary validated above is explicitly identified by its own revision, not represented as running the latest test commit.

## Outside-in hosted acceptance

Both tests ran against the specific pinned API and frontend Preview deployments, with synthetic accounts only. No paid providers, phone calls or external customer actions occurred.

1. [Run 43872852247](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43872852247): **success**. Frontend signup reached the isolated API. The same credentials were rejected by shared staging and production. The account was deleted.
2. [Run 43874094532](https://github.com/mathewshebin21-design/VOXERAASSISTANT/actions/runs/43874094532): **success**. Two independent tenants, voice-policy persistence and isolation, assigned-number read permissions, simulated call idempotency and lifecycle, transcript suppression without recording notice, cross-tenant call denials, call erasure and account cleanup.
3. Independent post-run Neon query: isolated schema `0012`; **zero voice policies, zero call rows and zero phone numbers**. Shared staging and production remain `0011`.

The isolated validation workflow lives at `.github/workflows/pr45-hosted-acceptance.yml`; the executable suite is `apps/previews/scripts/pr45-hosted-isolation.mjs`. It can run on explicit dispatch or push updates to this isolated acceptance script. Its git ref is restricted to the PR45 branch. It validates pinned origins and the deployed application SHA before any synthetic writes.

## Remaining release blockers (not waived)

- **PR #45 is a draft**. GitHub currently reports `mergeable=false` / `mergeable_state=dirty`; investigate before any merge, and run full candidate checks for the final commit.
- The frontend homepage is still a three-design demo selector; authenticated operator and customer workflows need complete browser acceptance, including error/loading states.
- Actual STT/TTS/LLM inference must enforce saved voice policy, region/provider/cost constraints **before provider spend**. Speech concurrency/cost accounting remains incomplete.
- Real AI/recording announcements must be played and proved; internal flags are not evidence of real playback.
- Durable staff-message fallback, carrier-confirmed human transfers, multilingual audio tests, retained-data housekeeping, recovery/load/monitoring evidence remain open.
- Billing test mode, signed webhooks, entitlement checks, GBP/INR cost modelling, contracting/tax setup, UK/India compliance reviews and owner-approved pilot remain open.
- Production at schema `0011` has not been migrated, and no production release, telephony launch, billing activation or external sales approval has been granted.

For complete commercial gating, see `docs/uk-india-commercial-readiness.md` and issue #44. **Do not call this production ready or ready to sell based on synthetic CI and Preview tests alone.**
