/**
 * InterviewTurnModel — all DB access for interview_turns (§7.4). A turn is
 * always reached through its parent session, so turn reads take a session_id
 * the caller has already owner-verified at the session layer (§11.7). The
 * write-through log enables resume-by-replay (spec Risk).
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type { IInterviewTurn } from "../types/interview";

export interface CreateInterviewTurnInput {
  sessionId: number;
  turnIndex: number;
  questions: unknown;
  answers?: unknown | null;
}

export class InterviewTurnModel extends BaseModel {
  protected static tableName = "interview_turns";
  protected static jsonFields = ["questions", "answers"];

  static async create(
    input: CreateInterviewTurnInput,
    trx?: QueryContext,
  ): Promise<IInterviewTurn> {
    const [row] = await this.table(trx)
      .insert(
        this.serializeJsonFields({
          session_id: input.sessionId,
          turn_index: input.turnIndex,
          questions: input.questions,
          answers: input.answers ?? null,
        }),
      )
      .returning("*");
    return this.deserializeJsonFields(row as Record<string, unknown>) as unknown as IInterviewTurn;
  }

  /** All turns for a session, in order. Caller verifies session ownership first. */
  static async listBySession(
    sessionId: number,
    trx?: QueryContext,
  ): Promise<IInterviewTurn[]> {
    const rows = await this.table(trx)
      .where({ session_id: sessionId })
      .orderBy("turn_index", "asc");
    return (rows as Record<string, unknown>[]).map(
      (row) => this.deserializeJsonFields(row) as unknown as IInterviewTurn,
    );
  }

  /**
   * Attach the PM's answers to an existing turn (write-through). Scoped by
   * session_id AND turn id so a caller can only update a turn of a session it
   * has already owner-verified (§11.7). Returns the updated row, or null if no
   * matching turn exists.
   */
  static async setAnswers(
    sessionId: number,
    turnIndex: number,
    answers: unknown,
    trx?: QueryContext,
  ): Promise<IInterviewTurn | null> {
    const [row] = await this.table(trx)
      .where({ session_id: sessionId, turn_index: turnIndex })
      .update(this.serializeJsonFields({ answers }))
      .returning("*");
    return row
      ? (this.deserializeJsonFields(row as Record<string, unknown>) as unknown as IInterviewTurn)
      : null;
  }
}
