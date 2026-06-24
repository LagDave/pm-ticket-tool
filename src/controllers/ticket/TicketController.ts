/**
 * TicketController — thin orchestration (§7.3). Receives validated input +
 * server-derived owner context, calls the service, shapes the response via the
 * shared builders. No business logic, no DB access. Mirrors
 * InterviewSessionController / GbpAutomationController (§6.1).
 */
import type { Request, Response } from "express";
import { requireOwner } from "../../middleware/ownerContext";
import type { SessionIdParam } from "../../validation/interviewSession";
import type {
  AddCommentBody,
  FinalizeTicketBody,
  TicketIdParam,
  UpdateTicketBody,
} from "../../validation/ticket";
import { TicketGenerationService } from "./feature-services/TicketGenerationService";
import { TicketService } from "./feature-services/TicketService";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class TicketController {
  /** POST /sessions/:id/ticket — generate a draft ticket from the session → 201. */
  static async generate(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const ticket = await TicketGenerationService.generateForSession(id, owner);
      return ok(res, ticket, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /tickets/:ticketId — fetch a ticket the caller owns + its comments → 200. */
  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { ticketId } = req.params as unknown as TicketIdParam;
      const result = await TicketService.getForOwner(ticketId, owner);
      return ok(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** PATCH /tickets/:ticketId — inline edit, version-guarded → 200. */
  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { ticketId } = req.params as unknown as TicketIdParam;
      const body = req.body as UpdateTicketBody;
      const result = await TicketService.updateForOwner(ticketId, owner, body);
      return ok(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /tickets/:ticketId/comments — add a comment → 201. */
  static async addComment(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { ticketId } = req.params as unknown as TicketIdParam;
      const { body } = req.body as AddCommentBody;
      const comment = await TicketService.addCommentForOwner(ticketId, owner, body);
      return ok(res, comment, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /tickets/:ticketId/finalize — flip draft→final, bump version → 200. */
  static async finalize(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { ticketId } = req.params as unknown as TicketIdParam;
      const { expectedVersion } = req.body as FinalizeTicketBody;
      const result = await TicketService.finalizeForOwner(
        ticketId,
        owner,
        expectedVersion,
      );
      return ok(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * POST /sessions/:id/propose-bits — merge-on-complete (spec T13). Turn the
   * session's finalized ticket into candidate project-context bits and return the
   * reconciliation plan against the project's existing bits → 200. Read-only: the
   * PM resolves the returned plan to apply (source "merged"). 409 NO_PROJECT when
   * the session has no project; 409 NO_FINAL_TICKET when nothing is finalized yet.
   */
  static async proposeBits(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const proposal = await TicketService.proposeBitsFromSession(id, owner);
      return ok(res, proposal);
    } catch (error) {
      return handleError(res, error);
    }
  }
}
