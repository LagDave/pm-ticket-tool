/**
 * Input validation schemas for the sessions domain (§11.2). Validation happens
 * at the boundary; once data reaches the controller it is trusted. Mirrors the
 * validation/ convention (schemas applied as route middleware).
 */
import { z } from "zod";

/** Bounds for the free-text initial request. Named, not magic (§4.2). */
const REQUEST_MIN_LENGTH = 1;
const REQUEST_MAX_LENGTH = 10_000;

/** Pagination bounds for the sessions list (§11.6). Named, not magic (§4.2). */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** The session statuses a PM may filter the dashboard list by (§11.6 filter). */
const SESSION_STATUSES = [
  "draft",
  "in_progress",
  "awaiting_input",
  "complete",
  "archived",
] as const;

export const createSessionSchema = z.object({
  originalRequest: z
    .string()
    .trim()
    .min(REQUEST_MIN_LENGTH, "originalRequest is required.")
    .max(REQUEST_MAX_LENGTH, "originalRequest is too long."),
});

export type CreateSessionBody = z.infer<typeof createSessionSchema>;

/** Route param schema for :id — a positive integer id. */
export const sessionIdParamSchema = z.object({
  id: z.coerce.number().int().positive("session id must be a positive integer."),
});

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;

/**
 * Query schema for GET /sessions (dashboard list, §11.6). `page`/`limit` coerce
 * from the query string and are bounded; `status` is an optional filter that
 * narrows the list to one status. Defaults keep the first page reasonable.
 */
export const listSessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  status: z.enum(SESSION_STATUSES).optional(),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
