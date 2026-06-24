/**
 * Ticket routes — thin (§7.2). Method/path + middleware (owner context, boundary
 * validation §11.2) + controller call. No business logic. Owner context is
 * mounted for the whole router so every handler is owner-scoped (§11.7); the
 * auth spec will add real authentication ahead of it.
 *
 * Paths are absolute and span two resources, so this router is mounted at "/" in
 * app.ts: generation hangs off the session resource (POST /sessions/:id/ticket),
 * while reads/edits address the ticket resource (/tickets/:ticketId…). These do
 * not collide with the sessions or engine routers (spec T3).
 */
import { Router } from "express";
import { TicketController } from "../controllers/ticket/TicketController";
import { ownerContext } from "../middleware/ownerContext";
import { validate } from "../middleware/validate";
import { sessionIdParamSchema } from "../validation/interviewSession";
import {
  addCommentSchema,
  finalizeTicketSchema,
  ticketIdParamSchema,
  updateTicketSchema,
} from "../validation/ticket";

const router = Router();

router.use(ownerContext);

// Generate a draft ticket from a completed/stopped session.
router.post(
  "/sessions/:id/ticket",
  validate(sessionIdParamSchema, "params"),
  TicketController.generate,
);

// Read / edit / comment / finalize a specific ticket.
router.get(
  "/tickets/:ticketId",
  validate(ticketIdParamSchema, "params"),
  TicketController.getById,
);
router.patch(
  "/tickets/:ticketId",
  validate(ticketIdParamSchema, "params"),
  validate(updateTicketSchema, "body"),
  TicketController.update,
);
router.post(
  "/tickets/:ticketId/comments",
  validate(ticketIdParamSchema, "params"),
  validate(addCommentSchema, "body"),
  TicketController.addComment,
);
router.post(
  "/tickets/:ticketId/finalize",
  validate(ticketIdParamSchema, "params"),
  validate(finalizeTicketSchema, "body"),
  TicketController.finalize,
);

export default router;
