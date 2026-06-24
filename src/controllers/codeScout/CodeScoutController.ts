/**
 * CodeScoutController — thin orchestration for the scout endpoints (§7.3).
 * Receives validated input + server-derived owner context, calls the service,
 * shapes the response via the shared builders. No business logic, no DB access.
 * Mirrors InterviewEngineController (§6.1).
 *
 * Background-job runtime (deploy spec runtime Option C, §21): the scan no longer
 * runs in the request. POST ENQUEUES a job and returns 202 (Accepted) so the
 * handler stays short under Vercel's serverless limits; GET reports the scan's
 * status and returns the findings once they are cached.
 */
import type { Request, Response } from "express";
import { requireOwner } from "../../middleware/ownerContext";
import type { SessionIdParam } from "../../validation/interviewSession";
import type { ScoutRequestBody } from "../../validation/codeScout";
import { CodeScoutService } from "./feature-services/CodeScoutService";
import { handleError, ok } from "./feature-utils/controllerResponses";

/** HTTP 202 Accepted — the scan was queued, not run in this request (§8.4). */
const HTTP_ACCEPTED = 202;

export class CodeScoutController {
  /**
   * POST /sessions/:id/scout — ENQUEUE a background scan and return 202 with the
   * job id (§21). The body carries the repo reference (provider + repoRef) to
   * scan (spec T5). Does NOT scan inline. When findings are already cached the
   * service short-circuits (alreadyComplete=true) and still returns 202 with no
   * job id, so a re-trigger is cheap and idempotent (§21.1). The client polls the
   * status endpoint for completion.
   */
  static async enqueueScout(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const body = req.body as ScoutRequestBody;
      const result = await CodeScoutService.enqueueScan(id, owner, {
        provider: body.provider,
        repoRef: body.repoRef,
      });
      return ok(res, result, HTTP_ACCEPTED);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * GET /sessions/:id/scout — report the scan status for a session, and include
   * the findings once the scan has completed (§21). While the job is
   * pending/running (or failed) there are no findings — the client keeps polling,
   * and spec 6's generation falls back to ungrounded until the findings land.
   * This path never scans.
   */
  static async getStatus(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const result = await CodeScoutService.getScanStatus(id, owner);
      return ok(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }
}
