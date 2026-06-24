/**
 * Projects routes — thin (§7.2). Method/path + middleware (owner context,
 * boundary validation §11.2) + controller call. No business logic. Owner
 * context is mounted for the whole router so every handler is owner-scoped
 * (§11.7); the auth spec will add real authentication ahead of it. Mirrors
 * routes/interviewSessions.ts.
 *
 * Scope: this router carries the plain project + bit CRUD (T4). The
 * reconcile/apply/import/bit-prompt sub-paths (T9/T10) extend this same router
 * later; their paths do not collide with the CRUD paths here.
 */
import { Router } from "express";
import { ProjectController } from "../controllers/project/ProjectController";
import { ownerContext } from "../middleware/ownerContext";
import { validate } from "../middleware/validate";
import {
  createProjectSchema,
  projectIdParamSchema,
  updateProjectSchema,
} from "../validation/project";
import {
  applyResolutionsSchema,
  bitIdParamSchema,
  candidateBitSchema,
  importBitsSchema,
  reconcileBitsSchema,
  updateBitSchema,
} from "../validation/projectBit";

const router = Router();

router.use(ownerContext);

// Project collection: create + list. Distinguished by method on the same path.
router.post("/", validate(createProjectSchema, "body"), ProjectController.create);
router.get("/", ProjectController.list);

// Project bits live under the project resource. Declared before the bare
// /:id routes for readability; Express matches by full path so /:id/bits never
// collides with /:id. The :id param is validated as a positive integer (§11.2).
router.get(
  "/:id/bits",
  validate(projectIdParamSchema, "params"),
  ProjectController.listBits,
);
router.post(
  "/:id/bits",
  validate(projectIdParamSchema, "params"),
  validate(candidateBitSchema, "body"),
  ProjectController.createBit,
);

// Reconcile / apply / import / generate-prompt (T9/T10). These sit at the
// /:id/bits/<verb> depth; their string verbs never collide with the numeric
// :bitId routes below (those are PATCH/DELETE on a positive-integer id). Each
// validates the project :id param and its body at the boundary (§11.2).
//
// POST /:id/bits/reconcile — plan only, no writes (preview-then-confirm).
router.post(
  "/:id/bits/reconcile",
  validate(projectIdParamSchema, "params"),
  validate(reconcileBitsSchema, "body"),
  ProjectController.reconcileBits,
);
// POST /:id/bits/apply — apply the human-confirmed resolutions in a transaction.
router.post(
  "/:id/bits/apply",
  validate(projectIdParamSchema, "params"),
  validate(applyResolutionsSchema, "body"),
  ProjectController.applyBits,
);
// POST /:id/bits/import — additive by default (returns a plan); clears only on force.
router.post(
  "/:id/bits/import",
  validate(projectIdParamSchema, "params"),
  validate(importBitsSchema, "body"),
  ProjectController.importBits,
);
// GET /:id/bit-prompt — the server-owned generate-bits prompt (embeds the schema).
router.get(
  "/:id/bit-prompt",
  validate(projectIdParamSchema, "params"),
  ProjectController.getBitPrompt,
);

router.patch(
  "/:id/bits/:bitId",
  validate(bitIdParamSchema, "params"),
  validate(updateBitSchema, "body"),
  ProjectController.updateBit,
);
router.delete(
  "/:id/bits/:bitId",
  validate(bitIdParamSchema, "params"),
  ProjectController.removeBit,
);

// Single project: read / update / delete, scoped to the owner. Share the /:id
// path, distinguished by method. Delete cascades project_bits and SET NULLs
// sessions' project_id via the FKs, so one owner-scoped row delete is atomic (§10.5).
router.get(
  "/:id",
  validate(projectIdParamSchema, "params"),
  ProjectController.getById,
);
router.patch(
  "/:id",
  validate(projectIdParamSchema, "params"),
  validate(updateProjectSchema, "body"),
  ProjectController.update,
);
router.delete(
  "/:id",
  validate(projectIdParamSchema, "params"),
  ProjectController.remove,
);

export default router;
