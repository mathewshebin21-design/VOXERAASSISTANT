# Putting the API online (Vercel + Neon, free tiers)

The website on Vercel needs the VOXERA API and a Postgres database for accounts and
workspaces. Both can run on your existing Vercel account at no cost:
**Vercel Hobby** for the API and the **Neon Free** database add-on, which is already installed on the "AI" team.

> Vercel Hobby is for personal, non-commercial use. Move to Vercel Pro before charging customers.
> Neon Free: 0.5–1 GB storage and 100 compute-hours a month; the database sleeps when idle and wakes in about a second.

## Current state (2026-11-01)
- [x] `voxera-api` project created (root `services/api`, FastAPI, London `lhr1`) at https://voxera-api-two.vercel.app. `/healthz` returns ok.
- [x] Vercel login protection switched off for `voxera-api`, so the website's server can reach it. The API has its own authentication.
- [x] `voxera-flow` has `VOXERA_API_URL=https://voxera-api-two.vercel.app` and has been redeployed.
- [ ] **Neon database:** create it and connect it to `voxera-api` (step 2 below), then redeploy `voxera-api`. Until then `/readyz` reports `unavailable` and sign-up shows "accounts server isn't reachable".

## Steps (about 5 minutes, all in the Vercel dashboard)
1. **Create the API project:** *Add New → Project →* import `mathewshebin21-design/voxeraassistant`.
   - Project name: `voxera-api`
   - Root Directory: `services/api` (Vercel detects FastAPI)
   - Production branch: the same one as `voxera-flow`
   - Deploy. The first build logs "no database attached — skipping migrations", which is expected.
2. **Create the database:** *Storage → Create Database → Neon.*
   - Region: **London (aws-eu-west-2)**
   - Name: `voxera-db`
   - Connect it to the `voxera-api` project, all environments, with no prefix.
3. **Redeploy `voxera-api`:** *Deployments → … → Redeploy.* The build now:
   - creates the restricted `voxera_app` database role, which owns nothing, so row-level security applies;
   - runs all migrations;
   - logs "migrations complete".
4. **Check it:** open `https://<voxera-api domain>/readyz`. It should return `{"status":"ready"}`.
5. **Connect the website:** in the `voxera-flow` project, open *Settings → Environment Variables*, add `VOXERA_API_URL = https://<voxera-api domain>` (no trailing slash), then redeploy `voxera-flow`.
6. Open the site, choose **Create workspace**, and sign up.

## How secrets are handled
- Nothing has to be copied by hand. Neon's connection injects `DATABASE_URL` / `DATABASE_URL_UNPOOLED`. From those, `app/platform.py` derives:
  - the runtime role's password, using HMAC-SHA256 of the owner password;
  - the JWT signing secret, the same way.
- Rotating the Neon password rotates both, and signs everyone out.
- Explicitly set `VOXERA_*` variables override anything derived.
- `VOXERA_ENV=production` can be set on `voxera-api`. The API then refuses to start with development credentials.

## Optional, paid
To switch on the live Claude brain or ElevenLabs voice, add their keys and monthly caps to `voxera-api` (see `phase-3-live-providers.md`).

## Known limits on serverless
- The login rate limiter and refresh-token de-duplication are kept per instance. Expect up to a few extra login attempts per minute across instances.
- Invitation emails aren't sent yet. The inviter gets a one-time link to send themselves.
