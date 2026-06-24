/**
 * Response builders for the ticket domain (§8.1, §8.2). Never hand-roll a
 * response per handler. `ok`/`fail` emit the canonical envelope; `handleError`
 * maps a typed TicketError → HTTP status in ONE place (§8.3) and never leaks
 * internals on the 500 path (§3.4). Mirrors interview/controllerResponses.
 */
import type { Response } from "express";
import { logger } from "../../../config/logger";
import { TicketError } from "./TicketError";

/** Success envelope (§8.1). */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null });
}

/** Error envelope (§8.1). Private — callers throw TicketError instead. */
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
 * One error→status mapper for the domain (§8.3, §8.4). Known typed errors map
 * by code; anything else is a generic 500 with no internal detail leaked (§3.4).
 */
export function handleError(res: Response, error: unknown): Response {
  if (error instanceof TicketError) {
    let status = 400;
    if (error.code.includes("NOT_FOUND")) status = 404;
    if (error.code.includes("ACCESS_DENIED") || error.code.includes("FORBIDDEN")) {
      status = 403;
    }
    if (error.code.includes("UNAUTHENTICATED")) status = 401;
    if (error.code.includes("VALIDATION")) status = 400;
    // A stale-version edit/finalize (optimistic-concurrency miss) is a 409
    // conflict — the PM must re-read before saving (spec Risk: concurrent edits).
    if (error.code.includes("CONFLICT") || error.code.includes("VERSION")) {
      status = 409;
    }
    // Merge-on-complete preconditions (spec T13): a session with no project, or no
    // finalized ticket yet, is a 409 — the resource is not in a state for the
    // operation, not a bad request (the body was well-formed).
    if (error.code === "NO_PROJECT" || error.code === "NO_FINAL_TICKET") {
      status = 409;
    }
    // An upstream model/generation failure is a 502 (bad gateway), distinct from
    // our own 500 (mirrors the interview domain).
    if (error.code.includes("GENERATION")) status = 502;
    // The public share endpoint over its rate limit (§11.3) → 429 Too Many Requests.
    if (error.code.includes("RATE_LIMITED")) status = 429;
    return fail(res, status, error.code, error.message, error.details);
  }

  logger.error({ err: error }, "Unhandled ticket-domain error");
  return fail(res, 500, "TICKET_ERROR", "Ticket operation failed.");
}
