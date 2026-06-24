/**
 * TicketGenerationService — turns a session's decision_record + original_request
 * (and any scout findings) into a persisted ticket via one structured-output call
 * (spec T1/What, §6.3, §7.1). The only layer between the controller and the
 * models/agent for generation; raises typed TicketError; enforces owner scope by
 * owner-verifying the session before reading its decisions and by writing the
 * ticket against that session (§11.7). Never touches req/res. Mirrors
 * InterviewEngineService (§6.1).
 *
 * Boundary discipline (§11.2): the model output is re-validated against the
 * boundary schema and rejected (never persisted) when off-shape — so malformed
 * Gherkin or a bad effort/priority value can never reach the DB (spec Risk).
 */
import { generateTicket } from "../../../agents/ticketAgent";
import { TICKET_GENERATION } from "../../../config";
import { logger } from "../../../config/logger";
import { DecisionRecordModel } from "../../../models/DecisionRecordModel";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { ScoutCacheModel } from "../../../models/ScoutCacheModel";
import { TicketModel } from "../../../models/TicketModel";
import { generateShareToken } from "../../../utils/shareToken";
import { generatedTicketSchema } from "../../../validation/ticket";
import type {
  GeneratedTicket,
  ITicket,
  OwnerContext,
  TicketDetails,
} from "../../../types/interview";
import { TicketError } from "../feature-utils/TicketError";
import { TicketMarkdownService } from "./TicketMarkdownService";

/** Illustrative paths shown to the model per area — pointers, not a checklist. */
const MAX_GROUNDING_PATHS = 3;

export class TicketGenerationService {
  /**
   * Generate and persist a draft ticket for a session (spec T1/What). Owner-verifies
   * the session first (throws SESSION_NOT_FOUND when absent or another owner's,
   * §11.7), reads its decisions and any cached scout findings, calls the agent
   * (with model fallback), re-validates the result at the boundary, renders the
   * full Markdown, mints a public share token, and persists. Returns the new ticket.
   *
   * Re-generation policy (spec Risk: clobbering edits): generation always writes
   * a NEW draft ticket row (version starts at 1, fresh share token) — it never
   * overwrites an existing edited/finalized ticket in place. The latest row is the
   * current one (models order by version desc), so prior states are preserved.
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
    const scoutFindings = await this.loadScoutFindings(sessionId);
    const generated = await this.callAgentWithFallback(
      { originalRequest: session.original_request, decisions, scoutFindings },
      sessionId,
    );

    const details = this.toDetails(generated);
    const renderedMarkdown = TicketMarkdownService.render({
      userStory: generated.user_story,
      acceptanceCriteria: generated.acceptance_criteria,
      effort: generated.effort,
      contextSummary: generated.context_summary,
      priority: generated.priority,
      details,
    });

    return TicketModel.create({
      sessionId,
      userStory: generated.user_story,
      acceptanceCriteria: generated.acceptance_criteria,
      effort: generated.effort,
      contextSummary: generated.context_summary,
      priority: generated.priority,
      details,
      renderedMarkdown,
      shareToken: generateShareToken(),
    });
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Read cached scout findings for the session and flatten them to compact lines
   * the agent can ground Codebase Grounding on (spec What). Best-effort: a missing
   * cache yields an empty list, and any read error is logged and degraded to empty
   * (§3.2) — scout grounding must never block ticket generation.
   */
  private static async loadScoutFindings(sessionId: number): Promise<string[]> {
    try {
      const cache = await ScoutCacheModel.findBySession(sessionId);
      if (!cache) return [];
      const lines: string[] = [];
      if (cache.findings.summary?.trim()) {
        lines.push(`Summary: ${cache.findings.summary.trim()}`);
      }
      for (const area of cache.findings.relevantAreas ?? []) {
        const touches = area.whatItTouches?.length
          ? ` Touches: ${area.whatItTouches.join(", ")}.`
          : "";
        const paths = area.paths?.length
          ? ` Paths: ${area.paths.slice(0, MAX_GROUNDING_PATHS).join(", ")}.`
          : "";
        lines.push(`${area.area}: ${area.whatExists}.${touches}${paths}`);
      }
      return lines;
    } catch (error) {
      logger.warn(
        { err: error, sessionId },
        "Failed to read scout findings for ticket grounding; proceeding without",
      );
      return [];
    }
  }

  /**
   * Map the agent's snake_case rich fields into the camelCase TicketDetails jsonb.
   * Best-effort fields default to empty/null so a thin model answer is still valid
   * (spec Risk: larger model output). A blank decision detail becomes null.
   */
  private static toDetails(generated: GeneratedTicket): TicketDetails {
    const problem = generated.problem_background?.trim();
    return {
      problemBackground: problem && problem.length > 0 ? problem : null,
      keyDecisions: (generated.key_decisions ?? []).map((kd) => ({
        label: kd.label,
        detail: kd.detail && kd.detail.trim().length > 0 ? kd.detail : null,
      })),
      openQuestions: generated.open_questions ?? [],
      successMetrics: generated.success_metrics ?? [],
      dependencies: generated.dependencies ?? [],
      codebaseGrounding: (generated.codebase_grounding ?? []).map((g) => ({
        area: g.area,
        note: g.note,
      })),
    };
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
