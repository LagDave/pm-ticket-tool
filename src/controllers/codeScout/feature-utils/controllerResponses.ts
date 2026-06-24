/**
 * Response builders for the code-scout domain (§8.1, §8.2). Never hand-roll a
 * response per handler. `ok`/`fail` emit the canonical envelope; `handleError`
 * maps a typed CodeScoutError → HTTP status in ONE place (§8.3) and never leaks
 * internals on the 500 path (§3.4). Mirrors interview/controllerResponses.
 */
import type { Response } from "express";
import { logger } from "../../../config/logger";
import { CodeScoutError } from "./CodeScoutError";

/** Success envelope (§8.1). */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null });
}

/** Error envelope (§8.1). Private — callers throw CodeScoutError instead. */
function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): Response {
  return res
    .status(status)
    .json({ success: false, data: null, error: { code, message, details } });
}

/**
 * One error→status mapper for the domain (§8.3). Known typed errors map by code;
 * anything else is a generic 500 with no internal detail leaked (§3.4).
 *
 * Codes:
 *  - *NOT_FOUND          → 404 (missing/other-owner session, or repo/path not found)
 *  - *AUTH*              → 401 (GitHub rejected — private repo or bad token)
 *  - *VALIDATION*        → 400 (bad input at the boundary)
 *  - *RATE_LIMITED*      → 429 (GitHub rate limit)
 *  - *GENERATION* / PROVIDER_REQUEST/BAD → 502 (upstream model/provider failure,
 *    distinct from our own 500)
 */
export function handleError(res: Response, error: unknown): Response {
  if (error instanceof CodeScoutError) {
    let status = 400;
    if (error.code.includes("NOT_FOUND")) status = 404;
    if (error.code.includes("AUTH")) status = 401;
    if (error.code.includes("VALIDATION")) status = 400;
    if (error.code.includes("RATE_LIMITED")) status = 429;
    if (
      error.code.includes("GENERATION") ||
      error.code === "PROVIDER_REQUEST_FAILED" ||
      error.code === "PROVIDER_BAD_RESPONSE"
    ) {
      status = 502;
    }
    return fail(res, status, error.code, error.message, error.details);
  }

  logger.error({ err: error }, "Unhandled code-scout-domain error");
  return fail(res, 500, "CODE_SCOUT_ERROR", "Code scout operation failed.");
}
