/**
 * Interview engine routes — thin (§7.2). Method/path + middleware (owner
 * context, boundary validation §11.2) + controller call. No business logic.
 * Mounted under /sessions alongside the foundation sessions router; these paths
 * (/:id/interview…) do not collide with the foundation routes (/ and /:id), so
 * the foundation router is extended, not broken (spec T5). Owner context is
 * mounted for the whole router so every handler is owner-scoped (§11.7).
 */
import { Router } from "express";
import { InterviewEngineController } from "../controllers/interview/InterviewEngineController";
import { ownerContext } from "../middleware/ownerContext";
import { validate } from "../middleware/validate";
import { submitAnswersSchema } from "../validation/interviewAnswers";
import { sessionIdParamSchema } from "../validation/interviewSession";

const router = Router();

router.use(ownerContext);

router.get(
  "/:id/interview",
  validate(sessionIdParamSchema, "params"),
  InterviewEngineController.getState,
);

router.post(
  "/:id/interview/next-batch",
  validate(sessionIdParamSchema, "params"),
  InterviewEngineController.nextBatch,
);

router.post(
  "/:id/interview/answers",
  validate(sessionIdParamSchema, "params"),
  validate(submitAnswersSchema, "body"),
  InterviewEngineController.submitAnswers,
);

export default router;
