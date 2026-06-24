/**
 * HealthController — thin orchestration (§7.3). Calls the health service and
 * shapes the response via the shared envelope builders. Returns the success
 * envelope only when the DB responds; on a failed ping it returns a 503 error
 * envelope (§8.1) without leaking internals (§3.4).
 */
import type { Request, Response } from "express";
import { logger } from "../../config/logger";
import { ok } from "../interview/feature-utils/controllerResponses";
import { HealthService } from "./feature-services/HealthService";

/** DB-unreachable HTTP status for a health probe. */
const SERVICE_UNAVAILABLE = 503;

export class HealthController {
  static async check(_req: Request, res: Response): Promise<Response> {
    try {
      const status = await HealthService.check();
      return ok(res, status);
    } catch (error) {
      logger.error({ err: error }, "Health check failed: DB unreachable");
      return res.status(SERVICE_UNAVAILABLE).json({
        success: false,
        data: null,
        error: {
          code: "HEALTH_UNAVAILABLE",
          message: "Service dependencies are not reachable.",
          details: null,
        },
      });
    }
  }
}
