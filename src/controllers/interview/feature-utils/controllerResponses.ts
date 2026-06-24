/**
 * Response builders for the interview domain (§8.1, §8.2). Never hand-roll a
 * response per handler. `ok`/`fail` emit the canonical envelope; `handleError`
 * maps a typed InterviewError → HTTP status in ONE place (§8.3) and never leaks
 * internals on the 500 path (§3.4). Mirrors gbp-automation/controllerResponses.
 */
import type { Response } from "express";
import { logger } from "../../../config/logger";
import { InterviewError } from "./InterviewError";

/** Success envelope (§8.1). */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null });
}

/** Error envelope (§8.1). Private — callers throw InterviewError instead. */
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
  if (error instanceof InterviewError) {
    let status = 400;
    if (error.code.includes("NOT_FOUND")) status = 404;
    if (error.code.includes("ACCESS_DENIED") || error.code.includes("FORBIDDEN")) {
      status = 403;
    }
    if (error.code.includes("UNAUTHENTICATED")) status = 401;
    if (error.code.includes("VALIDATION")) status = 400;
    // Engine domain (spec 2): a conflicting interview state is 409; an upstream
    // model/generation failure is 502 (bad gateway), distinct from our own 500.
    if (error.code.includes("CONFLICT") || error.code.includes("COMPLETE")) {
      status = 409;
    }
    if (error.code.includes("GENERATION")) status = 502;
    return fail(res, status, error.code, error.message, error.details);
  }

  logger.error({ err: error }, "Unhandled interview-domain error");
  return fail(res, 500, "INTERVIEW_ERROR", "Interview operation failed.");
}
