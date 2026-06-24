/**
 * TicketGenerationService — turns a session's decision_record + original_request
 * into a persisted ticket via one structured-output call (spec T1, §6.3, §7.1).
 * The only layer between the controller and the models/agent for generation;
 * raises typed TicketError; enforces owner scope by owner-verifying the session
 * before reading its decisions and by writing the ticket against that session
 * (§11.7). Never touches req/res. Mirrors InterviewEngineService (§6.1).
 *
 * Grounding (project bits): when the session is attached to a project with active
 * bits, they are loaded and passed to the agent as ORIENTATION (the decisions stay
 * the source of truth) so the ticket reflects the real app. Mirrors the engine's
 * loadProjectGrounding.
 *
 * Boundary discipline (§11.2): the model output is re-validated against the
 * boundary schema and rejected (never persisted) when off-shape — so malformed
 * Gherkin or a bad effort value can never reach the DB (spec Risk).
 */
import { generateTicket } from "../../../agents/ticketAgent";
import { TICKET_GENERATION } from "../../../config";
import { logger } from "../../../config/logger";
import { DecisionRecordModel } from "../../../models/DecisionRecordModel";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { ProjectBitModel } from "../../../models/ProjectBitModel";
import { ProjectModel } from "../../../models/ProjectModel";
import { TicketModel } from "../../../models/TicketModel";
import { generatedTicketSchema } from "../../../validation/ticket";
import type {
  GeneratedTicket,
  ITicket,
  OwnerContext,
} from "../../../types/interview";
import type { ProjectGrounding } from "../../../types/project";
import { TicketError } from "../feature-utils/TicketError";
import { TicketMarkdownService } from "./TicketMarkdownService";

export class TicketGenerationService {
  /**
   * Generate and persist a draft ticket for a session (spec T1). Owner-verifies
   * the session first (throws SESSION_NOT_FOUND when absent or another owner's,
   * §11.7), reads its decisions, grounds in the project bits when attached, calls
   * the agent (with model fallback), re-validates the result at the boundary,
   * renders Markdown, and persists. Returns the new ticket row.
   *
   * Re-generation policy (spec Risk: clobbering edits): generation always writes
   * a NEW draft ticket row (version starts at 1) — it never overwrites an
   * existing edited/finalized ticket in place. The latest row is the current one
   * (models order by version desc), so prior states are preserved, not clobbered.
   */
  static async generateForSession(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<ITicket> {
    const session = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    if (!session) {
      throw new TicketError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found.`,
        { sessionId },
      );
    }

    const decisions = await DecisionRecordModel.listBySession(sessionId);
    // Ground the ticket in the session's project bits when attached (orientation
    // only — the decisions remain the source of truth). Undefined → unchanged.
    const grounding = await this.loadProjectGrounding(session.project_id, owner);
    const generated = await this.callAgentWithFallback(
      { originalRequest: session.original_request, decisions, grounding },
      sessionId,
    );

    const renderedMarkdown = TicketMarkdownService.render({
      userStory: generated.user_story,
      acceptanceCriteria: generated.acceptance_criteria,
      effort: generated.effort,
      contextSummary: generated.context_summary,
    });

    return TicketModel.create({
      sessionId,
      userStory: generated.user_story,
      acceptanceCriteria: generated.acceptance_criteria,
      effort: generated.effort,
      contextSummary: generated.context_summary,
      renderedMarkdown,
    });
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Load the project-bits grounding for a session's project, or undefined when
   * there is no project / no active bits. Orientation for the ticket; mirrors
   * InterviewEngineService.loadProjectGrounding (owner-scoped, §11.7).
   */
  private static async loadProjectGrounding(
    projectId: number | null,
    owner: OwnerContext,
  ): Promise<ProjectGrounding | undefined> {
    if (projectId === null) return undefined;
    const project = await ProjectModel.findByIdForOwner(projectId, owner);
    if (!project) return undefined;
    const bits = await ProjectBitModel.listActiveByProject(project.id);
    if (bits.length === 0) return undefined;
    return { projectName: project.name, bits };
  }

  /**
   * Call the agent; on a model-rejection error, retry once with the fallback
   * model (spec model guidance). Re-validate the parsed output at the boundary;
   * reject (never persist) anything off-schema.
   */
  private static async callAgentWithFallback(
    params: Parameters<typeof generateTicket>[0],
    sessionId: number,
  ): Promise<GeneratedTicket> {
    let raw: unknown;
    try {
      raw = await generateTicket(params, TICKET_GENERATION.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, sessionId, model: TICKET_GENERATION.MODEL },
        "Primary model failed; retrying ticket generation with fallback",
      );
      try {
        raw = await generateTicket(params, TICKET_GENERATION.FALLBACK_MODEL);
      } catch {
        throw new TicketError(
          "TICKET_GENERATION_FAILED",
          "The ticket generator could not produce a ticket.",
          { sessionId },
        );
      }
    }
    return this.parseTicketOrThrow(raw, sessionId);
  }

  /** Re-validate the model output at the boundary; throw GENERATION on failure (§11.2). */
  private static parseTicketOrThrow(raw: unknown, sessionId: number): GeneratedTicket {
    const parsed = generatedTicketSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { sessionId, issues: parsed.error.issues.map((i) => i.message) },
        "Generated ticket failed boundary validation; rejecting",
      );
      throw new TicketError(
        "TICKET_GENERATION_INVALID",
        "The ticket generator returned a malformed ticket.",
        { sessionId },
      );
    }
    return parsed.data as GeneratedTicket;
  }
}
