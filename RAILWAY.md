# Deploy — PM Ticket Tool (Railway, single service)

Runbook for the deploy plan `plans/06242026-pm-tool-deploy` (Rev 2). Runtime
decision: **one Railway service**. A single long-running Express process serves
all three surfaces from one origin:

- the **React/Vite SPA** as a static build (`frontend/dist`) with a client-routing
  catch-all;
- the **Express JSON API**, mounted under `/api` (the SPA calls `/api/*`
  same-origin, §17.3);
- the **code scout** as an **in-process** background worker that drains the
  `scout_jobs` queue every ~10s (§21) — no cron, no internal HTTP trigger.

This supersedes the earlier Vercel + Neon serverless plan: Vercel Hobby's 10s
function limit does not fit this AI app. The Vercel files (`vercel.json`,
`api/index.ts`) are left in the repo but are **not** on the Railway path
(`api/index.ts` is excluded from the Railway start command; it only compiles).

This file commits **no secrets** (§5.1) — every value below is set in the Railway
dashboard, never in the repo.

---

## 1. Environment variables (Railway → Project → Service → Variables)

All are **server-side**. None carries a `VITE_` prefix, so none reaches the
browser bundle (§17.3). Do **not** set `VITE_API_BASE_URL` — the SPA defaults to
the relative `/api`, which is correct for the shared origin.

| Variable | Required | Value | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | **Railway-provided** | Add a Railway Postgres plugin and reference its `DATABASE_URL` (e.g. `${{Postgres.DATABASE_URL}}`). Railway injects it. |
| `DATABASE_SSL` | **yes** | `false` over the **internal** network; `true` if you connect over the **public** proxy | Railway's private network (`*.railway.internal`) needs no TLS. The public proxy host does — set `true` then. Env-driven (§10.6/§5.4). |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | no | `true` (default) | Only set `false` for a cert that can't chain to the public CA bundle (§5.4). |
| `DATABASE_POOL_MODE` | **yes** | `persistent` | A long-running server keeps a warm pool (min 2 / max 10). Not the serverless tiny pool (§10.6). |
| `NODE_ENV` | **yes** | `production` | Structured JSON logs; turns `SERVE_STATIC` and `RUN_SCOUT_WORKER` ON by default. |
| `PORT` | **provided** | **Railway-injected** | Railway sets `PORT`; the server binds it on `0.0.0.0`. Do not hardcode. |
| `ANTHROPIC_API_KEY` | **yes** | your Anthropic key | Server-side only; powers interview/ticket/triage/scout. Never in the bundle (§5.1/§17.3). |
| `RUN_SCOUT_WORKER` | optional | `true` (default in prod) | Drains the scout queue in-process (§21). Leave unset in prod (defaults ON). Set `false` only if you run the worker elsewhere. |
| `SERVE_STATIC` | optional | `true` (default in prod) | Serves the SPA + mounts the API under `/api`. Leave unset in prod (defaults ON). |
| `CORS_ORIGINS` | **yes** | the deployment origin, e.g. `https://your-app.up.railway.app` | Comma-separated; **no wildcard** (§11.4). Same-origin SPA calls don't strictly need it, but set it for correctness and any cross-origin tools. Add custom domains here too. |
| `GITHUB_TOKEN` | optional | a GitHub token | Only for **private** repos or higher rate limits. Public-repo scans work unauthenticated; leave empty otherwise. Server-side only (§5.1). |
| `LOG_LEVEL` | optional | `info` (default) | |
| `SCOUT_WORKER_SECRET` | **unused on Railway** | — | The Vercel-cron HTTP trigger (`POST /api/internal/scout/process`) is **not** the active path here; the worker runs in-process. The endpoint still exists and stays fail-closed when this is unset. Leave it unset. |

---

## 2. Build and start commands

Defined in `railway.json` (repo root) so the service is reproducible:

- **Build command:** `npm install && npm run build`
  - `npm run build` runs `build:frontend` then `build:backend`:
    - `build:frontend` → `cd frontend && npm install && npm run build` → emits `frontend/dist`.
    - `build:backend` → `tsc -p tsconfig.json` → emits `dist/` (including `dist/knexfile.js` and the compiled migrations as `.js`).
  - Order matters: the frontend builds first so the compiled server can serve `frontend/dist` (the static path resolves to `frontend/dist` from `dist/src/middleware/`).
- **Start command:** `npm run start:prod`
  - = `npm run migrate:prod && node dist/src/index.js`
  - `migrate:prod` runs `knex migrate:latest --knexfile dist/knexfile.js` against the live `DATABASE_URL` (the **compiled** migrations, resolved relative to `__dirname`, §10.3) **before** the server binds. Single instance, so migrate-then-start is safe.
  - Then `node dist/src/index.js` starts the server: it builds the single-service app (API under `/api` + SPA), binds `PORT` on `0.0.0.0`, and starts the in-process scout worker.
- **Health check path:** `/health` (Railway pings it; the server exposes a root `/health` alias that returns the success envelope only when Postgres responds).

### Migration approach

Migrations run as a **pre-start step inside the start command** (`migrate:prod`
before `node dist/src/index.js`). Because the service is a single instance, a
migrate-then-start start command is acceptable — there is no second instance to
race the migration. The migrations are the **identical** Knex files proven against
local Docker Postgres; on Railway they apply as compiled `.js` against the
Railway-provided `DATABASE_URL`. No manual DDL (§10.3).

If you prefer a separate Railway **deploy/release** step over a pre-start step,
set the deploy command to `npm run migrate:prod` and the start command to
`node dist/src/index.js`; both reach the same result.

---

## 3. Deploy steps

1. **Create the Railway project** and add a **PostgreSQL** plugin. Reference its
   `DATABASE_URL` from the service variables.
2. **Connect the GitHub repo** to the service so a push to `main` auto-deploys.
3. **Set the env vars** from section 1 (at minimum: `DATABASE_URL`, `DATABASE_SSL`,
   `DATABASE_POOL_MODE=persistent`, `NODE_ENV=production`, `ANTHROPIC_API_KEY`,
   `CORS_ORIGINS`). `PORT` is injected; `SERVE_STATIC`/`RUN_SCOUT_WORKER` default
   ON in prod.
4. **Deploy.** Railway runs the build command, then the start command, which
   migrates the DB and starts the server. The health check at `/health` gates the
   rollout.
5. **Verify.** `GET https://<your-app>/health` → success envelope; open
   `https://<your-app>/` → the SPA; create a session, run the interview, generate
   a ticket; trigger a scout and confirm it drains (the in-process worker logs
   "Scout job claimed" then "Scout job completed; findings cached").

---

## 4. How the scout runs on Railway (§21)

The scout is a **queued DB job**, drained **in-process** by the web server — not
inline in a request, and not by an external cron:

- **Enqueue (request path):** `POST /api/sessions/:id/scout` enqueues a `pending`
  `scout_jobs` row and returns **202** in ~5ms. `GET /api/sessions/:id/scout`
  polls `{status, findings?}`.
- **Drain (in-process):** on startup the server calls
  `ScoutJobProcessor.runForever()` (via `src/workers/scoutWorker.ts`), which polls
  the queue every ~2s and drains it by calling `CodeScoutService` **directly**
  (§21.3 — the same service the request path used; not reimplemented, not over
  HTTP). The claim is race-safe (`FOR UPDATE SKIP LOCKED`, §21.1) and burns one
  attempt at claim time, so bounded retry holds even on a crash (§21.2).
- **Crash isolation:** a scout failure never brings down the web server — the
  processor records re-queue/dead-letter and never throws to its caller, and the
  loop has an outer Pino-logged backstop (§21.4).

The Vercel-cron path (`POST /internal/scout/process` + `SCOUT_WORKER_SECRET`) is
**unused** on Railway. The code is left intact (it still type-checks, lints, and
is covered by tests) but is not the active runtime.

---

## 5. Rollback

- **Redeploy a previous build:** Railway keeps deploy history — roll back to the
  last green deploy from the dashboard.
- **Schema reproducibility:** Railway prod and local Docker dev share the
  **identical** Knex migrations, so the schema can be rebuilt anywhere with
  `knex migrate:latest`. A bad migration rolls back with
  `npm run migrate:rollback` (dev) or `knex migrate:rollback --knexfile dist/knexfile.js`
  (compiled) against the target `DATABASE_URL`.
- **Local dev is unchanged:** `npm run dev` still runs the Vite dev server + the
  root-mounted API (no static serving, no in-process worker — use
  `npm run scout:work` locally for the queue).
