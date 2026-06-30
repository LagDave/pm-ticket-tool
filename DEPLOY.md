# Deploy — PM Ticket Tool (Vercel + Neon)

Runbook for the deploy plan `plans/06242026-pm-tool-deploy`. Runtime decision:
**everything on Vercel** — the React/Vite SPA as a static build, the Express API
as a single serverless function, and the code scout as a queued DB job drained by
**Vercel Cron** (runtime Option C, §21). One origin: the SPA and the API share the
deployment URL; the SPA calls the API at the relative path `/api`.

This file is the script the browser-driven deploy follows. It commits **no
secrets** (§5.1) — every value below is set in the Vercel dashboard, never in the
repo.

---

## 1. Environment variables (set in Vercel → Project → Settings → Environment Variables)

All are **server-side / Production scope**. None carries a `VITE_` prefix, so
none reaches the browser bundle (§17.3). Do not set `VITE_API_BASE_URL` — the SPA
defaults to the relative `/api`, which is correct for the shared origin.

| Variable | Required | Value | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | Neon **pooled** connection string | Must be the **pooler** host (contains `-pooler`), not the direct endpoint. Include `?sslmode=require`. Example: `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require` |
| `DATABASE_SSL` | **yes** | `true` | Enables TLS to Neon (§10.6). |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | no | `true` (default) | Leave `true`. Neon's cert chains to the public CA bundle. Only set `false` for a provider whose cert can't chain (§5.4). |
| `DATABASE_POOL_MODE` | **yes** | `serverless` | Uses a tiny Knex pool (min 0, max 1) so many warm functions don't exhaust Neon's connection limit (§10.6). Local dev omits this and defaults to `persistent`. |
| `NODE_ENV` | **yes** | `production` | Structured JSON logs; production config path. |
| `CORS_ORIGINS` | **yes** | the deployment origin, e.g. `https://your-app.vercel.app` | Comma-separated; **no wildcard** (§11.4). Add custom domains here too. Same-origin SPA calls don't strictly need it, but set it for correctness and any cross-origin tools. |
| `ANTHROPIC_API_KEY` | **yes** | your Anthropic key | Server-side only; powers interview/ticket/triage/scout. Never in the bundle (§5.1/§17.3). |
| `SCOUT_WORKER_SECRET` | **yes** | a strong random string | Guards `POST /api/internal/scout/process`. Vercel Cron must send it as the `x-scout-worker-secret` header (see §3). When unset the trigger is **fail-closed** (refuses every caller), so the cron would be a no-op — set it. |
| `GITHUB_TOKEN` | optional | a GitHub token | Only for **private** repos or higher rate limits. Public-repo scans work unauthenticated; leave empty otherwise. Server-side only (§5.1). |
| `LOG_LEVEL` | optional | `info` (default) | |

Generate a worker secret:

```bash
openssl rand -hex 32
```

---

## 2. Deploy steps

1. **Import the repo** into Vercel (New Project → import the GitHub repo). Set the
   production branch to `main`. Vercel auto-deploys on every push to `main`.
2. **Framework preset:** leave as **Other**. The repo's `vercel.json` already
   defines the build:
   - `buildCommand`: `cd frontend && npm install && npm run build` (Vite static build)
   - `outputDirectory`: `frontend/dist`
   - the Express API is the serverless function `api/index.ts` (Vercel detects the
     `api/` directory and builds it automatically; root `npm install` provides its
     deps).
3. **Set the environment variables** from §1 (Production scope).
4. **Deploy.** Trigger the first deployment (push to `main`, or "Deploy" in the
   dashboard).
5. **Run the migrations against Neon — once, after `DATABASE_URL` is set** (§10.3).
   See §4 below. Do this before real traffic.
6. **Verify the cron.** Vercel registers the cron from `vercel.json` on deploy. It
   hits `POST /api/internal/scout/process` every minute to drain the scout queue.
   Confirm `SCOUT_WORKER_SECRET` is set and Vercel Cron is configured to send the
   `x-scout-worker-secret` header (Project → Settings → Cron Jobs). Until the
   secret is set the processor is fail-closed and the queue won't drain.
7. **Smoke test** the live URL (deploy spec T6): `GET /api/health` returns
   `database: "up"`; create a session; run an interview; generate a ticket;
   enqueue a scout and confirm it moves `pending → done` within a minute or two
   (cron-driven).

---

## 3. How the scout processor runs on Vercel (runtime Option C, §21)

- `POST /api/sessions/:id/scout` enqueues a `scout_jobs` row and returns **202** in
  ~5 ms — the request handler is trivially short and serverless-safe.
- **Vercel Cron** (in `vercel.json` `crons`) hits `POST /api/internal/scout/process`
  every minute. The endpoint is machine-to-machine, guarded by the
  `x-scout-worker-secret` header (§5.4), and drains all pending jobs per invocation
  via `ScoutJobProcessor.drain()` (the same service the request path uses, §21.3).
- The function's `maxDuration` is **60s** (`vercel.json` `functions`), enough for a
  bounded scan (~13–15s observed) and to drain several queued jobs. Raise toward
  the plan ceiling (up to 300s on Pro) if a deep queue needs it.
- **Locally there is no cron:** `npm run scout:work` runs the same processor in a
  poll loop.

---

## 4. Run migrations against Neon (`migrate:deploy`)

Run **once** after `DATABASE_URL` is set in Vercel, before real traffic. Two ways:

**A — from your machine (recommended, simplest):** point the deploy script at the
Neon pooled URL and run it locally. It compiles the app and runs the **compiled**
migrations (`dist/src/database/migrations/*.js`) — the same files Vercel ships.

```bash
DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require' \
DATABASE_SSL=true \
NODE_ENV=production \
npm run migrate:deploy
```

`migrate:deploy` = `npm run build && knex migrate:latest --knexfile dist/knexfile.js`.
Expect `Batch 1 run: 5 migrations` on a fresh Neon database (foundation, ticket,
triage, scout_cache, scout_jobs). It is idempotent — a second run reports
`Already up to date`.

**B — Neon SQL editor:** not used. All schema reaches Neon through the Knex
migrations only; never run manual DDL (§10.3).

> Note: the migration runner resolves its directory relative to the connection
> module and picks the extension from the runtime — `.js` when compiled (prod /
> `migrate:deploy`), `.ts` in local dev (`npm run migrate`). This is why the same
> migrations apply unchanged to Docker (dev) and Neon (prod). A database first
> migrated with one extension records that extension in `knex_migrations`, so
> always migrate Neon with `migrate:deploy` (`.js`) from its first run — don't mix
> `npm run migrate` (`.ts`) against Neon.

---

## 5. Rollback

- **App/runtime:** in Vercel, promote the previous deployment (Deployments → ⋯ →
  Promote to Production), or revert the offending commit on `main` (auto-deploys).
  Never force-push.
- **Schema:** dev (Docker) and prod (Neon) share the identical Knex migrations, so
  the schema is reproducible from the migration files. To undo the last migration
  batch against Neon, run a rollback with the same env as §4 (compiled knexfile):
  ```bash
  DATABASE_URL='...neon pooled...' DATABASE_SSL=true NODE_ENV=production \
    node ./node_modules/knex/bin/cli.js migrate:rollback --knexfile dist/knexfile.js
  ```
  (Build first if `dist/` is stale: `npm run build`.)

---

## 6. Local development is unchanged

- `npm run dev` still boots the Express server (`tsx watch src/index.ts`) listening
  on `:4222` against Docker Postgres (`:8765`), no SSL, `DATABASE_POOL_MODE`
  unset → `persistent` warm pool.
- The Vite dev server proxies `/api` → `http://localhost:4222` and strips the
  `/api` prefix, so the SPA's relative `/api` base works the same in dev and prod.
- `npm run scout:work` drains the scout queue locally (no cron needed).
