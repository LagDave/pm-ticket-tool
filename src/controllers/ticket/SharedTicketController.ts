/**
 * SharedTicketController — thin orchestration for the public read-only share route
 * (§7.3). No owner context (the token is the capability); a validated token param
 * goes in, a content-only DTO comes out via the shared builders. No business logic,
 * no DB access. Mirrors TicketController (§6.1).
 */
import type { Request, Response } from "express";
import type { ShareTokenParam } from "../../validation/ticket";
import { SharedTicketService } from "./feature-services/SharedTicketService";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class SharedTicketController {
  /** GET /shared/tickets/:token — public read-only ticket by share token → 200. */
  static async getByToken(req: Request, res: Response): Promise<Response> {
    try {
      const { token } = req.params as unknown as ShareTokenParam;
      const ticket = await SharedTicketService.getByToken(token);
      return ok(res, ticket);
    } catch (error) {
      return handleError(res, error);
    }
  }
}
