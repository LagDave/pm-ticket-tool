/**
 * In-process scout queue worker (deploy spec Rev 2, Railway single service, §21).
 * On Railway there is no cron: the long-running web process drains the scout_jobs
 * queue itself. This is the Railway counterpart of `scripts/scout-work.ts` (the
 * local CLI loop) and of the Vercel-cron `POST /internal/scout/process` trigger —
 * the SAME ScoutJobProcessor.runForever, called DIRECTLY (not over HTTP) so no
 * internal endpoint or worker secret is on the active Railway path.
 *
 * §21 conformance is inherited from ScoutJobProcessor (idempotent claim §21.1,
 * bounded-retry + dead-letter §21.2, calls CodeScoutService not its own logic
 * §21.3, Pino-logged per-job §21.4). This wrapper adds web-server crash isolation:
 * processNext already never throws to its caller, but should the loop itself ever
 * reject (e.g. the DB pool dies under it), the rejection is caught and Pino-logged
 * here (§21.4) — it NEVER propagates to take down the HTTP server. Fire-and-forget
 * by design: the loop runs for the life of the process; stop() aborts it on
 * graceful shutdown.
 */
import { logger } from "../config/logger";
import { ScoutJobProcessor } from "../services/scoutJobs/ScoutJobProcessor";

/** Handle to the running worker loop; stop() ends it on graceful shutdown. */
export interface ScoutWorkerHandle {
  stop(): void;
}

/**
 * Start the scout worker loop in the background and return a stop handle. The
 * loop polls + drains the queue forever (ScoutJobProcessor.runForever) until the
 * returned handle's stop() aborts it. Any unexpected loop-level rejection is
 * logged and swallowed so a scout failure can never crash the web server.
 */
export function startScoutWorker(): ScoutWorkerHandle {
  const controller = new AbortController();

  logger.info("Starting in-process scout worker (single-service mode, §21)");

  // Fire-and-forget: the loop owns the process's background work. The .catch is
  // the crash backstop (§21.4) — runForever should not reject, but if it does the
  // web server stays up.
  void ScoutJobProcessor.runForever(controller.signal).catch((error: unknown) => {
    logger.error(
      { err: error },
      "In-process scout worker loop exited unexpectedly; web server stays up (§21.4)",
    );
  });

  return {
    stop(): void {
      controller.abort();
    },
  };
}
