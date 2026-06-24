/**
 * TriageService — the light, low-effort classification of the original request
 * into the two-speed label (spec T1, §6.3, §7.1). The only layer between the
 * controller and the models/agent for triage; raises typed InterviewError only
 * on an owner-scope miss; enforces owner scope by owner-verifying the session
 * before reading it and by writing the label against that session (§11.7).
 * Never touches req/res. Mirrors TicketGenerationService / InterviewEngineService
 * (§6.1).
 *
 * Failure policy (spec Risk: misclassification): the classifier defaults to
 * `scoped` whenever the model is unsure, returns off-schema output, or fails
 * outright (after a fallback-model retry). The failure mode is therefore always
 * "too much interview", never a thin ticket from genuinely scoped work — and a
 * transient model outage degrades to the full interview rather than erroring the
 * PM out of the tool (§3.1: every async call is wrapped).
 */
import { classifyRequest } from "../../../agents/triageAgent";
import { TRIAGE } from "../../../config";
import { logger } from "../../../config/logger";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { triageClassificationSchema } from "../../../validation/triage";
import type {
  IInterviewSession,
  OwnerContext,
  TriageClassification,
  TriageOutcome,
  TriageResult,
  TriageRoute,
} from "../../../types/interview";
import { InterviewError } from "../feature-utils/InterviewError";

/** The safe default when the classifier is unsure or unavailable (spec Risk). */
const DEFAULT_RESULT: TriageResult = "scoped";

export class TriageService {
  /**
   * Classify a session's original request, persist the label, and return the
   * route to take (spec T1/T2). Owner-verifies the session first (throws
   * SESSION_NOT_FOUND when absent or another owner's, §11.7), then resolves the
   * label — honoring the `override`, which forces the full interview regardless
   * of the label (spec What: triage is never a hard gate).
   *
   * Idempotent (spec Risk / User QA): a session that already carries a
   * triage_result returns that persisted label WITHOUT a fresh model call, so a
   * re-trigger (a StrictMode double-mount, a refetch, a re-run clone landing back
   * on triage) is cheap and stable. Only the first triage classifies and writes.
   */
  static async triageSession(
    sessionId: number,
    owner: OwnerContext,
    override: boolean,
  ): Promise<TriageOutcome> {
    const session = await this.requireSession(sessionId, owner);
    const result = await this.resolveResult(session, owner);

    return {
      sessionId,
      result,
      route: this.resolveRoute(result, override),
      overridden: override,
    };
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * The persisted label if the session was already triaged (idempotent
   * re-trigger), otherwise classify once and persist owner-scoped before
   * returning. The setTriageResultForOwner write carries the owner filter so a
   * concurrent re-trigger still cannot touch another owner's row (§11.7); the
   * worst case under a race is two harmless classify calls converging on the same
   * persisted label, never a leak or a divergent result.
   */
  private static async resolveResult(
    session: IInterviewSession,
    owner: OwnerContext,
  ): Promise<TriageResult> {
    if (session.triage_result) {
      logger.info(
        { sessionId: session.id, result: session.triage_result },
        "Triage already classified; returning persisted label (idempotent)",
      );
      return session.triage_result;
    }

    const result = await this.classifyWithFallback(session);
    await InterviewSessionModel.setTriageResultForOwner(session.id, owner, result);
    return result;
  }

  /** Owner-verify a session or throw NOT_FOUND (§11.7). */
  private static async requireSession(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<IInterviewSession> {
    const session = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    if (!session) {
      throw new InterviewError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found.`,
        { sessionId },
      );
    }
    return session;
  }

  /**
   * The route to take: `simple` → ticket-draft (spec 3), `scoped` → interview
   * (spec 2). The override always forces the interview, even from a `simple`
   * label — the PM can choose more process than the classifier suggested (spec
   * What). The reverse direction (skip a scoped result to drafting) is the
   * frontend's call on top of the persisted label; the backend never blocks it.
   */
  private static resolveRoute(result: TriageResult, override: boolean): TriageRoute {
    if (override) return "interview";
    return result === "simple" ? "ticket" : "interview";
  }

  /**
   * Call the classifier; on a model-rejection error, retry once with the
   * fallback model (mirrors the engine/ticket fallback). Any hard failure, or an
   * off-schema/unparsable result, degrades to `scoped` rather than throwing
   * (spec Risk: default to scoped when unsure). Never persists a non-label.
   */
  private static async classifyWithFallback(
    session: IInterviewSession,
  ): Promise<TriageResult> {
    const params = { originalRequest: session.original_request };
    let raw: unknown;
    try {
      raw = await classifyRequest(params, TRIAGE.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, sessionId: session.id, model: TRIAGE.MODEL },
        "Primary model failed; retrying triage with fallback",
      );
      try {
        raw = await classifyRequest(params, TRIAGE.FALLBACK_MODEL);
      } catch (fallbackError) {
        logger.warn(
          { err: fallbackError, sessionId: session.id },
          "Triage classification failed on both models; defaulting to scoped",
        );
        return DEFAULT_RESULT;
      }
    }
    return this.parseOrDefault(raw, session.id);
  }

  /**
   * Re-validate the model output at the boundary (§11.2). On success, return the
   * label; on an off-schema result, log and default to `scoped` (spec Risk) —
   * triage never throws on a bad classification, it just routes to the safe path.
   */
  private static parseOrDefault(raw: unknown, sessionId: number): TriageResult {
    const parsed = triageClassificationSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { sessionId, issues: parsed.error.issues.map((i) => i.message) },
        "Triage classification was off-schema; defaulting to scoped",
      );
      return DEFAULT_RESULT;
    }
    const classification: TriageClassification = parsed.data;
    logger.info(
      { sessionId, result: classification.result },
      "Triage classified the request",
    );
    return classification.result;
  }
}
