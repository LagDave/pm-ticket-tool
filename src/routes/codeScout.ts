/**
 * Code scout routes — thin (§7.2). Method/path + middleware (owner context,
 * boundary validation §11.2) + controller call. No business logic. Mounted under
 * /sessions alongside the foundation/engine routers; these paths (/:id/scout) do
 * not collide with the sessions (/ and /:id), engine (/:id/interview…), or ticket
 * (/:id/ticket) routes (spec T4). Owner context is mounted for the whole router
 * so every handler is owner-scoped (§11.7).
 *
 * Background-job runtime (deploy spec runtime Option C, §21): POST ENQUEUES a
 * scan (202, no inline scan); GET reports the scan's status and returns the
 * findings once cached.
 */
import { Router } from "express";
import { CodeScoutController } from "../controllers/codeScout/CodeScoutController";
import { ownerContext } from "../middleware/ownerContext";
import { validate } from "../middleware/validate";
import { scoutRequestSchema } from "../validation/codeScout";
import { sessionIdParamSchema } from "../validation/interviewSession";

const router = Router();

router.use(ownerContext);

// Enqueue a background scan for the session → 202 + job id (no inline scan, §21).
router.post(
  "/:id/scout",
  validate(sessionIdParamSchema, "params"),
  validate(scoutRequestSchema, "body"),
  CodeScoutController.enqueueScout,
);

// Report the scan status (and findings once cached). Never scans.
router.get(
  "/:id/scout",
  validate(sessionIdParamSchema, "params"),
  CodeScoutController.getStatus,
);

export default router;
