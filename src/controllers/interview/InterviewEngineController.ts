/**
 * InterviewEngineController — thin orchestration for the engine endpoints
 * (§7.3). Receives validated input + server-derived owner context, calls the
 * service, shapes the response via the shared builders. No business logic, no
 * DB access. Mirrors InterviewSessionController / GbpAutomationController (§6.1).
 */
import type { Request, Response } from "express";
import { requireOwner } from "../../middleware/ownerContext";
import type { SessionIdParam } from "../../validation/interviewSession";
import type { SubmitAnswersBody } from "../../validation/interviewAnswers";
import { InterviewEngineService } from "./feature-services/InterviewEngineService";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class InterviewEngineController {
  /** GET /sessions/:id/interview — full engine state (turns + decisions + status). */
  static async getState(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const state = await InterviewEngineService.getState(id, owner);
      return ok(res, state);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /sessions/:id/interview/next-batch — generate the next batch through the gate. */
  static async nextBatch(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const state = await InterviewEngineService.advanceNextBatch(id, owner);
      return ok(res, state);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /sessions/:id/interview/answers — submit answers to the open batch. */
  static async submitAnswers(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as SessionIdParam;
      const body = req.body as SubmitAnswersBody;
      const state = await InterviewEngineService.submitAnswers(id, owner, body);
      return ok(res, state);
    } catch (error) {
      return handleError(res, error);
    }
  }
}
