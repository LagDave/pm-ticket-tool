/**
 * InterviewSessionService — business logic for the sessions domain (§7.1). The
 * only layer between the controller and the models; raises typed
 * InterviewError on rule violations; enforces owner scope by passing the
 * server-derived owner context into every model call (§11.7). Never touches
 * req/res. Mirrors GbpReviewReplyService (§6.1).
 */
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { ProjectModel } from "../../../models/ProjectModel";
import { TicketModel } from "../../../models/TicketModel";
import type {
  IInterviewSession,
  InterviewState,
  OwnerContext,
  PaginatedResult,
  SessionStatus,
} from "../../../types/interview";
import type { ListSessionsQuery } from "../../../validation/interviewSession";
import { InterviewError } from "../feature-utils/InterviewError";
import { InterviewEngineService } from "./InterviewEngineService";
import { TitleService } from "./TitleService";

export class InterviewSessionService {
  /**
   * Create a session from the PM's initial request text, with a concise
   * generated display title (User QA: auto-generated session title). The title
   * comes from one cheap LOW-effort call (TitleService) before insert, so it is
   * the session's label immediately. Title generation degrades to null on any
   * failure (never throws), so a model blip can never fail the create — the
   * session is still created, just without a title until finalize.
   */
  static async createSession(
    owner: OwnerContext,
    originalRequest: string,
    projectId?: number,
  ): Promise<IInterviewSession> {
    // Owner-verify the project before attaching it, so a session can only ground
    // against a project the caller owns (§11.7). Absent → an ungrounded session.
    if (projectId !== undefined) {
      const project = await ProjectModel.findByIdForOwner(projectId, owner);
      if (!project) {
        throw new InterviewError(
          "PROJECT_NOT_FOUND",
          `Project ${projectId} was not found.`,
          { projectId },
        );
      }
    }
    const title = await TitleService.generate({ kind: "request", originalRequest });
    return InterviewSessionModel.create(owner, { originalRequest, title, projectId });
  }

  /**
   * Fetch a session the caller owns. Throws NOT_FOUND when the row is absent or
   * owned by someone else — the model's owner scope makes those indistinguishable
   * (§11.7), so we never reveal another owner's session even exists.
   */
  static async getSessionForOwner(
    id: number,
    owner: OwnerContext,
  ): Promise<IInterviewSession> {
    const session = await InterviewSessionModel.findByIdForOwner(id, owner);
    if (!session) {
      throw new InterviewError("SESSION_NOT_FOUND", `Session ${id} was not found.`, {
        id,
      });
    }
    return session;
  }

  /**
   * One owner-scoped page of the caller's sessions for the dashboard (spec 4 T1).
   * Reads the page and the total under the same owner + optional status filter
   * (§11.7) and assembles the standard pagination envelope (§11.6). `totalPages`
   * is at least 1 so an empty list still reports a valid first page.
   */
  static async listSessions(
    owner: OwnerContext,
    query: ListSessionsQuery,
  ): Promise<PaginatedResult<IInterviewSession>> {
    const { page, limit, status, search } = query;
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([
      InterviewSessionModel.listPageForOwner(owner, { limit, offset, status, search }),
      InterviewSessionModel.countForOwner(owner, { status, search }),
    ]);
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Assemble the resume state for a session the caller owns (spec 4 T2). Reuses
   * the engine's replay (turns + decisions + status) rather than re-deriving
   * interview logic here, then enriches it with the latest ticket id so the
   * dashboard can route to "view ticket" (T6). The engine owner-verifies the
   * session and throws NOT_FOUND on a missing/foreign session (§11.7).
   */
  static async getSessionState(
    id: number,
    owner: OwnerContext,
  ): Promise<InterviewState> {
    const state = await InterviewEngineService.getState(id, owner);
    const ticket = await TicketModel.findLatestBySessionForOwner(id, owner);
    return { ...state, ticketId: ticket?.id ?? null };
  }

  /**
   * Re-run a prior session as a fresh clone (spec 4 T3, the locked default):
   * read the source owner-scoped, then create a brand-new session seeded only
   * from its original_request — new id, status reset to draft, owner from server
   * context, and no turns or decisions copied. The source is left untouched.
   * Throws NOT_FOUND when the source is missing or another owner's (§11.7).
   */
  static async cloneSession(
    sourceId: number,
    owner: OwnerContext,
  ): Promise<IInterviewSession> {
    const source = await this.getSessionForOwner(sourceId, owner);
    const RESET_STATUS: SessionStatus = "draft";
    // A clone re-runs from the same request, so it gets its own create-time title
    // the same way a fresh session does (User QA). Degrades to null on failure.
    const title = await TitleService.generate({
      kind: "request",
      originalRequest: source.original_request,
    });
    return InterviewSessionModel.create(owner, {
      originalRequest: source.original_request,
      status: RESET_STATUS,
      title,
    });
  }

  /**
   * Delete a session the caller owns, returning its id. Owner-verifies first via
   * getSessionForOwner, which throws NOT_FOUND when the session is missing or
   * another owner's (§11.7) — so a foreign id is indistinguishable from a missing
   * one and never leaks. The model delete then removes the row; every child table
   * (interview_turns, decision_record, tickets → ticket_comments, scout_cache,
   * scout_jobs) cascades on the session_id FK, so children are reaped atomically
   * by the database — no app-side multi-table delete (§10.5).
   */
  static async deleteSession(
    id: number,
    owner: OwnerContext,
  ): Promise<{ id: number }> {
    await this.getSessionForOwner(id, owner);
    await InterviewSessionModel.deleteForOwner(id, owner);
    return { id };
  }
}
