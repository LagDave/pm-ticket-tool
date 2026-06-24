/**
 * Server entry point. Importing ./config validates required env at startup and
 * throws (fail fast, §5.6) before the server binds. Builds the app, starts the
 * in-process scout worker when configured, and listens.
 *
 * Two runtimes, one entry (deploy spec Rev 2):
 *  - Local dev (`npm run dev`, SERVE_STATIC off): the ROOT-mounted createApp() —
 *    the Vite dev server proxies /api → here and strips the prefix, so the
 *    backend serves /sessions, /health, … at the root. Unchanged from before.
 *  - Single Railway service (SERVE_STATIC on, prod): createServerApp() mounts the
 *    API under /api and serves the built SPA from the same origin, and the scout
 *    queue is drained IN-PROCESS (RUN_SCOUT_WORKER) instead of by an external cron.
 *
 * Binds config.port on 0.0.0.0 (APP_CONSTANTS.BIND_HOST) so a container platform
 * (Railway) can route traffic; config.port already reads process.env.PORT, which
 * Railway injects, falling back to the local default.
 */
import type { Server } from "http";
import { createApp } from "./app";
import { createServerApp } from "./server";
import { APP_CONSTANTS, config } from "./config";
import { logger } from "./config/logger";
import { db } from "./database/connection";
import { startScoutWorker, type ScoutWorkerHandle } from "./workers/scoutWorker";

function start(): void {
  // Single-service composition (API under /api + SPA) when serving static;
  // the root-mounted API app for local dev behind the Vite proxy.
  const app = config.serveStatic ? createServerApp() : createApp();

  const server: Server = app.listen(config.port, APP_CONSTANTS.BIND_HOST, () => {
    logger.info(
      {
        port: config.port,
        host: APP_CONSTANTS.BIND_HOST,
        env: config.nodeEnv,
        serveStatic: config.serveStatic,
        runScoutWorker: config.runScoutWorker,
      },
      `PM Tool API listening on ${APP_CONSTANTS.BIND_HOST}:${config.port}`,
    );
  });

  // In-process scout queue worker (§21). On Railway there is no cron, so the web
  // process drains the queue itself. A scout error never reaches the web server:
  // the processor records re-queue/dead-letter and the loop is crash-isolated.
  const scoutWorker: ScoutWorkerHandle | null = config.runScoutWorker
    ? startScoutWorker()
    : null;

  // Graceful shutdown — stop the worker loop, drain the HTTP server, then the DB
  // pool (§10.6). Order matters: stop accepting work, finish in-flight, close DB.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    scoutWorker?.stop();
    server.close(() => {
      void db.destroy().then(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
