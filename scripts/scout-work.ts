/**
 * Local scout worker (`npm run scout:work`) — the development driver for the
 * scout background processor (deploy spec runtime Option C, §21). On Vercel the
 * processor runs via Cron hitting POST /internal/scout/process; locally there is
 * no cron, so this long-running process polls the scout_jobs queue and drains it
 * with the SAME ScoutJobProcessor (§21.3 — no separate logic). Stop it with
 * Ctrl-C; SIGINT/SIGTERM abort the loop and close the DB pool cleanly.
 *
 * Not a test — a dev convenience. The processor logs each job's lifecycle
 * through Pino (§21.4); this script just keeps it running and shuts it down.
 */
import { db } from "../src/database/connection";
import { logger } from "../src/config/logger";
import { ScoutJobProcessor } from "../src/services/scoutJobs/ScoutJobProcessor";

async function main(): Promise<void> {
  await db.migrate.latest();
  const controller = new AbortController();

  const stop = (signal: string): void => {
    logger.info({ signal }, "scout:work received shutdown signal");
    controller.abort();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await ScoutJobProcessor.runForever(controller.signal);
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    logger.error({ err: error }, "scout:work crashed");
    await db.destroy();
    process.exit(1);
  });
