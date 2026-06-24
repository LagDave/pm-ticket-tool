/**
 * Response builders for the project domain (§8.1, §8.2). Never hand-roll a
 * response per handler. `ok`/`fail` emit the canonical envelope; `handleError`
 * maps a typed ProjectError → HTTP status in ONE place (§8.3) and never leaks
 * internals on the 500 path (§3.4). Mirrors interview/controllerResponses.
 */
import type { Response } from "express";
import { logger } from "../../../config/logger";
import { ProjectError } from "./ProjectError";

/** Success envelope (§8.1). */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null });
}

/** Error envelope (§8.1). Private — callers throw ProjectError instead. */
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
 * One error→status mapper for the domain (§8.3). Known typed errors map by
 * code; anything else is a generic 500 with no internal detail leaked (§3.4).
 */
export function handleError(res: Response, error: unknown): Response {
  if (error instanceof ProjectError) {
    let status = 400;
    if (error.code.includes("NOT_FOUND")) status = 404;
    if (error.code.includes("ACCESS_DENIED") || error.code.includes("FORBIDDEN")) {
      status = 403;
    }
    if (error.code.includes("UNAUTHENTICATED")) status = 401;
    if (error.code.includes("VALIDATION")) status = 400;
    return fail(res, status, error.code, error.message, error.details);
  }

  logger.error({ err: error }, "Unhandled project-domain error");
  return fail(res, 500, "PROJECT_ERROR", "Project operation failed.");
}
