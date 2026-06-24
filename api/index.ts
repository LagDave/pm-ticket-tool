/**
 * Vercel serverless entry (deploy spec T3, runtime Option A/C). Vercel invokes a
 * Node request handler per request; an Express app IS a `(req, res)` listener, so
 * this file mounts the SAME app `createApp()` builds (src/app.ts) — no business
 * logic and no second app here (§7.2). Importing src/config validates required
 * env at cold start and fails fast on a missing/malformed value (§5.6) before any
 * request is served.
 *
 * Why an outer mount at `/api`: every route in src/app.ts is mounted at the root
 * (`/health`, `/sessions`, `/internal`, …), but the SPA and Vercel address the
 * API under one shared origin at `/api/*` (frontend/src/api/index.ts base `/api`,
 * vercel.json rewrites). Mounting the configured app under `/api` here lets the
 * real path (`/api/health`) reach the real route (`/health`) without touching a
 * single route file. Locally the Vite dev proxy strips `/api` instead, so the
 * same backend routes serve both paths (vite.config.ts) — the app itself is
 * environment-agnostic.
 *
 * The app is built once at module scope and reused across warm invocations on the
 * same function instance, so the central Knex pool (§10.6) is created once per
 * instance, not per request — paired with the serverless pool bounds
 * (DATABASE_POOL_MODE=serverless) that keep Neon connections bounded.
 */
import express, { Application } from "express";
import { createApp } from "../src/app";

const API_PREFIX = "/api";

function buildHandler(): Application {
  const app = express();
  // Mount the configured Express app under the shared `/api` origin segment.
  app.use(API_PREFIX, createApp());
  return app;
}

const handler = buildHandler();

export default handler;
