/**
 * InternalScoutController — the guarded internal trigger that drives the scout
 * background processor (deploy spec runtime Option C, §21). This is the endpoint
 * Vercel Cron hits on a schedule; one invocation drains the pending queue.
 *
 * NOT an owner-scoped endpoint: it is machine-to-machine. It is guarded by a
 * shared-secret header (§5.4) — getScoutWorkerSecret() must be set AND the
 * caller must present the matching header, or the request is refused with a
 * typed error. Fail-closed: when no secret is configured the trigger refuses
 * every caller, so it is never an open scan-runner (the local worker still works
 * in-process without the HTTP path). The secret is never logged (§5.3).
 *
 * No business logic lives here (§7.3): it authorizes, calls the processor
 * service (§21.3), and shapes the response with the shared builders.
 */
import type { Request, Response } from "express";
import { SCOUT_JOB } from "../../config";
import { getScoutWorkerSecret } from "../../config";
import { logger } from "../../config/logger";
import { ScoutJobProcessor } from "../../services/scoutJobs/ScoutJobProcessor";
import { CodeScoutError } from "./feature-utils/CodeScoutError";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class InternalScoutController {
  /**
   * POST /internal/scout/process — drain the pending scout queue once (Vercel
   * Cron's entry point). Authorizes via the shared secret, then drains and
   * reports how many jobs were processed. The processor itself never throws on a
   * scan failure (it records re-queue/dead-letter), so this returns 200 with a
   * count even when a job failed — the failure is durable on the job row.
   */
  static async process(req: Request, res: Response): Promise<Response> {
    try {
      InternalScoutController.authorize(req);
      const processed = await ScoutJobProcessor.drain();
      logger.info({ processed }, "Scout processor trigger drained the queue");
      return ok(res, { processed });
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * Reject the caller unless a worker secret is configured AND the request
   * presents the exact matching header (§5.4). Throws a typed CodeScoutError
   * (mapped to 401) on a miss; never echoes the expected or received secret
   * (§5.3, §3.4).
   */
  private static authorize(req: Request): void {
    const expected = getScoutWorkerSecret();
    const presented = req.header(SCOUT_JOB.TRIGGER_HEADER);
    if (!expected || presented !== expected) {
      throw new CodeScoutError(
        "SCOUT_TRIGGER_AUTH_FAILED",
        "The scout processor trigger requires a valid worker secret.",
      );
    }
  }
}
