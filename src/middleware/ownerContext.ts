/**
 * Owner-context middleware. Derives the caller's owner scope from SERVER
 * context and attaches it to the request, so models can require it (§11.7,
 * §5.5). Owner identity is NEVER read from the request body/query — that would
 * let a client read another owner's data.
 *
 * Foundation has no auth spec yet, so the owner id is resolved from a
 * server-side dev header/env as a placeholder. The later auth spec replaces the
 * body of `resolveOwner` with real JWT verification; the seam (req.ownerContext)
 * stays identical, so nothing downstream changes.
 */
import type { NextFunction, Request, Response } from "express";
import type { OwnerContext } from "../types/interview";
import { InterviewError } from "../controllers/interview/feature-utils/InterviewError";

/** Dev owner id when no auth layer is mounted yet. Server-side only. */
const DEV_DEFAULT_OWNER_ID = 1;

declare module "express-serve-static-core" {
  interface Request {
    ownerContext?: OwnerContext;
  }
}

/**
 * Resolve owner scope from server-trusted context. Foundation: an `x-dev-user-id`
 * header (set by trusted local tooling/tests) or the dev default. This header is
 * a stand-in for an authenticated principal — it is NOT client-authoritative in
 * prod, where the auth spec will derive identity from a verified JWT instead.
 */
function resolveOwner(req: Request): OwnerContext {
  const header = req.header("x-dev-user-id");
  const ownerUserId = header ? Number(header) : DEV_DEFAULT_OWNER_ID;
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    throw new InterviewError(
      "UNAUTHENTICATED",
      "Could not resolve a valid owner from server context.",
    );
  }
  // organization_id is nullable in v1 (spec Pushback); single-tenant for now.
  return { ownerUserId, organizationId: null };
}

export function ownerContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    req.ownerContext = resolveOwner(req);
    next();
  } catch (error) {
    next(error);
  }
}

/** Read the resolved owner context or throw — controllers call this, never the DB. */
export function requireOwner(req: Request): OwnerContext {
  if (!req.ownerContext) {
    throw new InterviewError(
      "UNAUTHENTICATED",
      "Owner context missing; ownerContext middleware not applied.",
    );
  }
  return req.ownerContext;
}
