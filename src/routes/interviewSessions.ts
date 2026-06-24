/**
 * Sessions routes — thin (§7.2). Method/path + middleware (owner context,
 * boundary validation §11.2) + controller call. No business logic. Owner
 * context is mounted for the whole router so every handler is owner-scoped
 * (§11.7); the auth spec will add real authentication ahead of it.
 */
import { Router } from "express";
import { InterviewSessionController } from "../controllers/interview/InterviewSessionController";
import { ownerContext } from "../middleware/ownerContext";
import { validate } from "../middleware/validate";
import {
  createSessionSchema,
  listSessionsQuerySchema,
  sessionIdParamSchema,
} from "../validation/interviewSession";
import { triageRequestSchema } from "../validation/triage";

const router = Router();

router.use(ownerContext);

router.post("/", validate(createSessionSchema, "body"), InterviewSessionController.create);
// Dashboard list (spec 4 T1): paginated + optionally status-filtered. Distinct
// from POST / (create) by method, and from /:id by path.
router.get("/", validate(listSessionsQuerySchema, "query"), InterviewSessionController.list);
// Re-run as a fresh clone (spec 4 T3) and resume-state read (spec 4 T2). These
// /:id sub-paths do not collide with the engine router's /:id/interview… paths.
router.post(
  "/:id/clone",
  validate(sessionIdParamSchema, "params"),
  InterviewSessionController.clone,
);
// Triage (spec 7): classify the request and return the route. The /:id/triage
// sub-path does not collide with the engine router's /:id/interview… paths or
// the foundation /:id read. Body carries the optional override flag (§11.2).
router.post(
  "/:id/triage",
  validate(sessionIdParamSchema, "params"),
  validate(triageRequestSchema, "body"),
  InterviewSessionController.triage,
);
router.get(
  "/:id/state",
  validate(sessionIdParamSchema, "params"),
  InterviewSessionController.getState,
);
router.get(
  "/:id",
  validate(sessionIdParamSchema, "params"),
  InterviewSessionController.getById,
);
// Delete a session the caller owns. Shares the /:id path with the GET above but
// is a distinct method, and every child table cascades on the session_id FK so a
// single owner-scoped row delete reaps turns, decisions, tickets/comments, and
// scout cache/jobs atomically (§10.5).
router.delete(
  "/:id",
  validate(sessionIdParamSchema, "params"),
  InterviewSessionController.remove,
);

export default router;
