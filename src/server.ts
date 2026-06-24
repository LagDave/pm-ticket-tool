/**
 * Single-service HTTP composition for Railway (deploy spec Rev 2). One Express
 * process serves three things from one origin:
 *   1. the JSON API — the SAME app createApp() builds (src/app.ts), mounted under
 *      `/api` so the SPA's relative `/api` base reaches it same-origin (§17.3);
 *   2. a root `/health` alias for the platform health check (Railway pings a
 *      path; this delegates to the SAME HealthController as /api/health, §7.3);
 *   3. the built SPA (frontend/dist) with a client-routing catch-all, when
 *      config.serveStatic is on (Railway prod) — see middleware/staticSpa.ts.
 *
 * Kept separate from app.ts so the API app stays root-mounted and unchanged for
 * tests (supertest hits /health, /sessions at the root), while this outer layer
 * composes the deploy runtime. No business logic here (§7.2): mounting + asset
 * wiring only. The Vercel entry (api/index.ts) is unchanged and unused on Railway.
 */
import express, { Application, Request, Response } from "express";
import { config } from "./config";
import { createApp } from "./app";
import { HealthController } from "./controllers/health/HealthController";
import { serveSpa } from "./middleware/staticSpa";

/** The origin segment the SPA + platform address the API under (§17.3). */
const API_PREFIX = "/api";

/**
 * Build the single-service Express app: API under /api, a root /health alias, and
 * (optionally) the SPA static build + catch-all. Returns a ready-to-listen app.
 */
export function createServerApp(): Application {
  const app = express();

  // Root health alias for the platform health check. Delegates to the SAME
  // controller as /api/health (§7.3) so there is one health implementation; the
  // probe can point at "/health" without going through the SPA catch-all.
  app.get("/health", (req: Request, res: Response) => HealthController.check(req, res));

  // The whole configured API under /api (Helmet, CORS, Pino, routes, backstops
  // all come from createApp()). The SPA calls /api/* same-origin; no /api route
  // is reimplemented here.
  app.use(API_PREFIX, createApp());

  // SPA static + client-routing catch-all (Railway prod). Mounted LAST so /api
  // and /health win; the catch-all skips those prefixes. Off in dev (Vite owns
  // the SPA), guarded by config.serveStatic.
  if (config.serveStatic) {
    serveSpa(app);
  }

  return app;
}
