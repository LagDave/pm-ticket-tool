/**
 * Server entry point. Importing ./config validates required env at startup and
 * throws (fail fast, §5.6) before the server binds. Builds the app and listens.
 *
 * Two runtimes, one entry (deploy spec Rev 2):
 *  - Local dev (`npm run dev`, SERVE_STATIC off): the ROOT-mounted createApp() —
 *    the Vite dev server proxies /api → here and strips the prefix, so the
 *    backend serves /sessions, /health, … at the root.
 *  - Single Railway service (SERVE_STATIC on, prod): createServerApp() mounts the
 *    API under /api and serves the built SPA from the same origin.
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
      },
      `PM Tool API listening on ${APP_CONSTANTS.BIND_HOST}:${config.port}`,
    );
  });

  // Graceful shutdown — drain the HTTP server, then the DB pool (§10.6). Order
  // matters: stop accepting connections, finish in-flight work, then close the DB.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void db.destroy().then(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
