/**
 * InterviewSessionController — thin orchestration (§7.3). Receives validated
 * input + server-derived owner context, calls the service, shapes the response
 * via the shared builders. No business logic, no DB access. Mirrors
 * GbpAutomationController (§6.1).
 */
import type { Request, Response } from "express";
import { requireOwner } from "../../middleware/ownerContext";
import type {
  CreateSessionBody,
  ListSessionsQuery,
  SessionIdParam,
} from "../../validation/interviewSession";
import type { TriageRequestBody } from "../../validation/triage";
import { InterviewSessionService } from "./feature-services/InterviewSessionService";
import { TriageService } from "./feature-services/TriageService";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class InterviewSessionController {
  /** POST /sessions — create a session from the request text → 201. */
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { originalRequest } = req.body as CreateSessionBody;
      const session = await InterviewSessionService.createSession(
        owner,
        originalRequest,
      );
      return ok(res, session, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /sessions — the caller's sessions, paginated + optionally filtered → 200 (spec 4 T1). */
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const query = req.query as unknown as ListSessionsQuery;
      const page = await InterviewSessionService.listSessions(owner, query);
      return ok(res, page);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /sessions/:id — fetch a session the caller owns → 200. */
  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const session = await InterviewSessionService.getSessionForOwner(id, owner);
      return ok(res, session);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /sessions/:id/state — resume state (turns + decisions + ticket id) → 200 (spec 4 T2). */
  static async getState(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const state = await InterviewSessionService.getSessionState(id, owner);
      return ok(res, state);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /sessions/:id/clone — re-run as a fresh cloned session → 201 (spec 4 T3). */
  static async clone(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const session = await InterviewSessionService.cloneSession(id, owner);
      return ok(res, session, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * POST /sessions/:id/triage — classify the request and return the route to
   * take → 200 (spec 7 T2). Thin: validated input + server owner → service →
   * envelope. The `override` flag forces the full interview regardless of the
   * label; the service persists the label and resolves the route.
   */
  static async triage(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const { override } = req.body as TriageRequestBody;
      const outcome = await TriageService.triageSession(id, owner, override);
      return ok(res, outcome);
    } catch (error) {
      return handleError(res, error);
    }
  }
}
