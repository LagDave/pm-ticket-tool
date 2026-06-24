/**
 * Server entry point. Importing ./config validates required env at startup and
 * throws (fail fast, §5.6) before the server binds. Builds the app and listens.
 */
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./config/logger";
import { db } from "./database/connection";

function start(): void {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `PM Tool API listening on port ${config.port}`,
    );
  });

  // Graceful shutdown — drain the HTTP server, then the DB pool (§10.6).
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
