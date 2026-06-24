/**
 * InterviewEngineService — orchestrates the adaptive interview loop (spec T2-T4):
 * generate → persist → answer → materiality gate → terminate (§6.3, §7.1). The
 * only layer between the controller and the models/agent; raises typed
 * InterviewError; enforces owner scope by passing the server-derived owner into
 * every model call (§11.7). Never touches req/res. Mirrors GbpReviewReplyService
 * (§6.1).
 *
 * Write-through (§10.5): each generated batch is one turn; each answer set is a
 * turn update plus its decision rows, written in one transaction. Resume is
 * replay-only: state is rebuilt from persisted turns + decisions; a batch is
 * never regenerated (spec What).
 */
import { generateBatch } from "../../../agents/interviewAgent";
import { INTERVIEW_ENGINE } from "../../../config";
import { logger } from "../../../config/logger";
import { BaseModel } from "../../../models/BaseModel";
import { DecisionRecordModel } from "../../../models/DecisionRecordModel";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { InterviewTurnModel } from "../../../models/InterviewTurnModel";
import { ScoutCacheModel } from "../../../models/ScoutCacheModel";
import { generatedBatchSchema } from "../../../validation/interviewQuestions";
import type { ScoutFindings } from "../../../types/codeScout";
import type {
  CreateDecisionRecordInput,
} from "../../../models/DecisionRecordModel";
import type {
  GeneratedBatch,
  IInterviewSession,
  IInterviewTurn,
  InterviewQuestion,
  InterviewState,
  OwnerContext,
  SubmitAnswersPayload,
} from "../../../types/interview";
import { InterviewError } from "../feature-utils/InterviewError";
import { MaterialityGateService } from "./MaterialityGateService";

export class InterviewEngineService {
  /**
   * Rebuild the full engine state for a session by replaying persisted rows
   * (spec T3 resume). Owner-verifies the session first; throws NOT_FOUND when
   * the session is absent or owned by someone else (§11.7).
   */
  static async getState(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<InterviewState> {
    const session = await this.requireSession(sessionId, owner);
    const [turns, decisions] = await Promise.all([
      InterviewTurnModel.listBySession(sessionId),
      DecisionRecordModel.listBySession(sessionId),
    ]);
    return {
      sessionId,
      originalRequest: session.original_request,
      status: session.status,
      turns,
      decisions,
      nextTurnIndex: turns.length,
      isComplete: session.status === "complete",
      // The engine replays interview state only; resolving the session's ticket
      // is the dashboard's concern (§2.1). InterviewSessionService.getSessionState
      // overrides this with the real latest ticket id (spec 4 T6).
      ticketId: null,
    };
  }

  /**
   * Run the materiality gate and, if it says continue, generate + persist the
   * next batch (spec T2/T4). If the gate terminates, mark the session complete.
   * Returns the refreshed state either way. Throws CONFLICT if a prior batch is
   * still unanswered (the PM must answer before advancing).
   */
  static async advanceNextBatch(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<InterviewState> {
    const session = await this.requireSession(sessionId, owner);
    if (session.status === "complete") {
      throw new InterviewError(
        "INTERVIEW_COMPLETE",
        `Interview for session ${sessionId} is already complete.`,
        { sessionId },
      );
    }

    const turns = await InterviewTurnModel.listBySession(sessionId);
    this.assertNoOpenBatch(turns, sessionId);

    const decision = MaterialityGateService.decide({
      roundsSoFar: turns.length,
      hasOpenMaterialDecisions: this.lastBatchHadOpenDecisions(turns),
    });

    if (!decision.shouldGenerate) {
      await this.markComplete(sessionId, owner);
      logger.info(
        { sessionId, reason: decision.reason },
        "Interview terminated by materiality gate",
      );
      return this.getState(sessionId, owner);
    }

    await this.generateAndPersistBatch(session, owner, turns.length);
    return this.getState(sessionId, owner);
  }

  /**
   * Persist the PM's answers to the current open batch and the structured
   * decisions they imply, atomically (spec T3, §10.5). A global "stop and
   * generate" marks the interview complete in the same transaction. Validates
   * each answer against the open turn's questions at the boundary (§11.2).
   */
  static async submitAnswers(
    sessionId: number,
    owner: OwnerContext,
    payload: SubmitAnswersPayload,
  ): Promise<InterviewState> {
    await this.requireSession(sessionId, owner);
    const turns = await InterviewTurnModel.listBySession(sessionId);
    const openTurn = this.requireOpenBatch(turns, sessionId);
    const questions = this.questionsOf(openTurn);

    const answerMap = this.validateAnswers(payload.answers, questions, sessionId);
    const decisions = this.toDecisionRows(sessionId, questions, answerMap);

    await BaseModel.runTransaction(async (trx) => {
      await InterviewTurnModel.setAnswers(
        sessionId,
        openTurn.turn_index,
        payload.answers,
        trx,
      );
      await DecisionRecordModel.createMany(decisions, trx);
      const nextStatus = payload.stopAndGenerate ? "complete" : "in_progress";
      await InterviewSessionModel.updateStatusForOwner(
        sessionId,
        owner,
        nextStatus,
        trx,
      );
    });

    return this.getState(sessionId, owner);
  }

  /* ----------------------------- private helpers ------------------------- */

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
   * Read the session's cached scout findings, or undefined on a miss (spec 6).
   * The session has already been owner-verified by the caller (§11.7), so this
   * read is scoped to a session the caller owns. Undefined routes generation to
   * the ungrounded fallback; findings route it to the grounded path.
   */
  private static async findCachedFindings(
    sessionId: number,
  ): Promise<ScoutFindings | undefined> {
    const cached = await ScoutCacheModel.findBySession(sessionId);
    return cached?.findings ?? undefined;
  }

  /** The most recent turn, or null when no batch exists yet. */
  private static lastTurn(turns: IInterviewTurn[]): IInterviewTurn | null {
    return turns.length > 0 ? turns[turns.length - 1] : null;
  }

  /** An open batch is the last turn whose answers are still null. */
  private static openTurn(turns: IInterviewTurn[]): IInterviewTurn | null {
    const last = this.lastTurn(turns);
    return last && last.answers === null ? last : null;
  }

  private static assertNoOpenBatch(turns: IInterviewTurn[], sessionId: number): void {
    if (this.openTurn(turns)) {
      throw new InterviewError(
        "OPEN_BATCH_CONFLICT",
        "The current batch must be answered before generating the next one.",
        { sessionId },
      );
    }
  }

  private static requireOpenBatch(
    turns: IInterviewTurn[],
    sessionId: number,
  ): IInterviewTurn {
    const open = this.openTurn(turns);
    if (!open) {
      throw new InterviewError(
        "NO_OPEN_BATCH_CONFLICT",
        "There is no open batch to answer; generate the next batch first.",
        { sessionId },
      );
    }
    return open;
  }

  /** Read the persisted questions off a turn (JSONB round-trips structured). */
  private static questionsOf(turn: IInterviewTurn): InterviewQuestion[] {
    const batch = turn.questions as { questions?: InterviewQuestion[] } | null;
    return batch?.questions ?? [];
  }

  /** Did the last persisted batch signal open material decisions? */
  private static lastBatchHadOpenDecisions(
    turns: IInterviewTurn[],
  ): boolean | undefined {
    const last = this.lastTurn(turns);
    if (!last) return undefined;
    const batch = last.questions as { hasOpenMaterialDecisions?: boolean } | null;
    return batch?.hasOpenMaterialDecisions ?? false;
  }

  /**
   * Validate submitted answers against the open turn's questions (§11.2):
   * every answer targets a real question, exactly one of optionId/otherText is
   * supplied, a chosen option exists, and free-text is only used where allowed.
   * Returns a map of questionId → answer for decision extraction.
   */
  private static validateAnswers(
    answers: SubmitAnswersPayload["answers"],
    questions: InterviewQuestion[],
    sessionId: number,
  ): Map<string, SubmitAnswersPayload["answers"][number]> {
    const byId = new Map(questions.map((q) => [q.id, q]));
    const result = new Map<string, SubmitAnswersPayload["answers"][number]>();

    for (const answer of answers) {
      const question = byId.get(answer.questionId);
      if (!question) {
        throw this.validationError(
          `Answer references unknown question "${answer.questionId}".`,
          sessionId,
        );
      }
      const hasOption = answer.optionId !== null;
      const hasOther = answer.otherText !== null && answer.otherText !== "";
      if (hasOption === hasOther) {
        throw this.validationError(
          `Answer for "${answer.questionId}" must set exactly one of optionId or otherText.`,
          sessionId,
        );
      }
      if (hasOption && !question.options.some((o) => o.id === answer.optionId)) {
        throw this.validationError(
          `Option "${answer.optionId}" is not valid for question "${answer.questionId}".`,
          sessionId,
        );
      }
      if (hasOther && !question.allowOther) {
        throw this.validationError(
          `Question "${answer.questionId}" does not allow a free-text answer.`,
          sessionId,
        );
      }
      result.set(answer.questionId, answer);
    }
    return result;
  }

  /** Build the structured decision rows from validated answers (source = answer). */
  private static toDecisionRows(
    sessionId: number,
    questions: InterviewQuestion[],
    answerMap: Map<string, SubmitAnswersPayload["answers"][number]>,
  ): CreateDecisionRecordInput[] {
    const rows: CreateDecisionRecordInput[] = [];
    for (const question of questions) {
      const answer = answerMap.get(question.id);
      if (!answer) continue; // unanswered questions record no decision
      const value =
        answer.optionId !== null
          ? { optionId: answer.optionId }
          : { otherText: answer.otherText };
      rows.push({ sessionId, key: question.decisionKey, value, source: "answer" });
    }
    return rows;
  }

  private static validationError(message: string, sessionId: number): InterviewError {
    return new InterviewError("VALIDATION_ERROR", message, { sessionId });
  }

  /** Mark the session complete, owner-scoped. */
  private static async markComplete(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<void> {
    await InterviewSessionModel.updateStatusForOwner(sessionId, owner, "complete");
  }

  /**
   * Generate one batch through the agent (with model fallback), re-validate it
   * at the boundary (§11.2), and persist it as the next turn. Marks the session
   * in_progress. Throws GENERATION on an unusable/off-schema model result so it
   * is never persisted (spec Risk).
   */
  private static async generateAndPersistBatch(
    session: IInterviewSession,
    owner: OwnerContext,
    turnIndex: number,
  ): Promise<void> {
    const decisions = await DecisionRecordModel.listBySession(session.id);
    // Branch once on "findings present" (spec 6 Pushback): read the cached scout
    // findings through the model (§7.4) — undefined on a miss routes the agent to
    // the ungrounded path, present routes it to the grounded path. Read-only here;
    // generation never writes the cache.
    const findings = await this.findCachedFindings(session.id);
    const params = {
      originalRequest: session.original_request,
      priorDecisions: decisions,
      roundNumber: turnIndex + 1,
      maxRounds: INTERVIEW_ENGINE.MAX_ROUNDS,
      maxQuestions: INTERVIEW_ENGINE.MAX_QUESTIONS_PER_BATCH,
      findings,
    };

    const batch = await this.callAgentWithFallback(params, session.id);

    if (batch.skipped && batch.skipped.length > 0) {
      logger.info(
        { sessionId: session.id, skipped: batch.skipped },
        "Grounding skipped questions the findings already answered",
      );
    }

    await BaseModel.runTransaction(async (trx) => {
      await InterviewTurnModel.create(
        {
          sessionId: session.id,
          turnIndex,
          // Persist the whole batch object so resume replays questions + the gate signal.
          questions: batch,
          answers: null,
        },
        trx,
      );
      await InterviewSessionModel.updateStatusForOwner(
        session.id,
        owner,
        "in_progress",
        trx,
      );
    });
  }

  /**
   * Call the agent; on a model-rejection error, retry once with the fallback
   * model (spec model guidance). Re-validate the parsed output at the boundary;
   * reject (never persist) anything off-schema.
   */
  private static async callAgentWithFallback(
    params: Parameters<typeof generateBatch>[0],
    sessionId: number,
  ): Promise<GeneratedBatch> {
    let raw: unknown;
    try {
      raw = await generateBatch(params, INTERVIEW_ENGINE.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, sessionId, model: INTERVIEW_ENGINE.MODEL },
        "Primary model failed; retrying with fallback",
      );
      try {
        raw = await generateBatch(params, INTERVIEW_ENGINE.FALLBACK_MODEL);
      } catch {
        throw new InterviewError(
          "BATCH_GENERATION_FAILED",
          "The interview engine could not generate the next batch.",
          { sessionId },
        );
      }
    }
    return this.parseBatchOrThrow(raw, sessionId);
  }

  /** Re-validate the model output at the boundary; throw GENERATION on failure (§11.2). */
  private static parseBatchOrThrow(raw: unknown, sessionId: number): GeneratedBatch {
    const parsed = generatedBatchSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { sessionId, issues: parsed.error.issues.map((i) => i.message) },
        "Model batch failed boundary validation; rejecting",
      );
      throw new InterviewError(
        "BATCH_GENERATION_INVALID",
        "The interview engine returned malformed questions.",
        { sessionId },
      );
    }
    return parsed.data as GeneratedBatch;
  }
}
