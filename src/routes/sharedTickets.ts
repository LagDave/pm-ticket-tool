/**
 * Public shared-ticket route (spec What) — thin (§7.2). This is the ONE
 * unauthenticated endpoint: no ownerContext, because the URL's capability token IS
 * the authorization (spec Risk; §11.1 public-route exception, like internalScout).
 * Defense in depth on the open door: the token param is validated at the boundary
 * (§11.2) and the route is rate-limited per IP (§11.3), even though a 256-bit token
 * already makes guessing infeasible. Mounted at "/" in app.ts; the absolute
 * /shared/tickets/:token path does not collide with the other routers.
 */
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { SharedTicketController } from "../controllers/ticket/SharedTicketController";
import { handleError } from "../controllers/ticket/feature-utils/controllerResponses";
import { TicketError } from "../controllers/ticket/feature-utils/TicketError";
import { validate } from "../middleware/validate";
import { shareTokenParamSchema } from "../validation/ticket";

/** Per-IP window for the public share read. Named, not magic (§4.2). */
const SHARE_RATE_WINDOW_MS = 60_000;
/** Max share reads per IP per window — generous for humans, bounds token probing. */
const SHARE_RATE_MAX = 60;

const router = Router();

const shareLimiter = rateLimit({
  windowMs: SHARE_RATE_WINDOW_MS,
  limit: SHARE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Keep the §8.1 envelope on a 429 (not the library's plain-text body) by routing
  // through the domain error mapper (§8.3).
  handler: (_req, res) =>
    handleError(
      res,
      new TicketError("SHARE_RATE_LIMITED", "Too many requests. Please slow down.", null),
    ),
});

router.get(
  "/shared/tickets/:token",
  shareLimiter,
  validate(shareTokenParamSchema, "params"),
  SharedTicketController.getByToken,
);

export default router;
