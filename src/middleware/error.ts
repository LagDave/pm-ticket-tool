/**
 * Express error + not-found middleware. Returns the canonical error envelope
 * (§8.1), logs full detail internally via Pino, and never leaks stack traces,
 * internal paths, or query details to clients (§3.4). Domain handlers map their
 * own typed errors before reaching here; this is the catch-all backstop.
 */
import { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";
import { InterviewError } from "../controllers/interview/feature-utils/InterviewError";
import { handleError } from "../controllers/interview/feature-utils/controllerResponses";

/** Standard error envelope (§8.1). */
function errorEnvelope(code: string, message: string, details: unknown = null) {
  return { success: false as const, data: null, error: { code, message, details } };
}

/** 404 for unmatched routes — returns the envelope, not an HTML page. */
export function notFoundHandler(req: Request, res: Response): Response {
  return res
    .status(404)
    .json(errorEnvelope("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
}

/**
 * Final error handler. Express identifies it by its four-arg signature, so
 * `next` must stay in the list even though it is unused.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): Response {
  // Typed domain errors surfaced by middleware (validation §11.2, owner context
  // §11.7) map to the right status through the one domain mapper (§8.3), not a
  // blanket 500.
  if (err instanceof InterviewError) {
    return handleError(res, err);
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error(
    { err, route: `${req.method} ${req.path}` },
    `Unhandled error: ${message}`,
  );
  // Generic message externally; the detail is in the log above (§3.4).
  return res
    .status(500)
    .json(errorEnvelope("INTERNAL_ERROR", "An unexpected error occurred."));
}
