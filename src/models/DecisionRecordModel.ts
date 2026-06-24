/**
 * DecisionRecordModel — all DB access for decision_record (§7.4). Structured
 * decisions (not chat text); append-only write-through log in foundation.
 * Reached through an owner-verified session (§11.7).
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type { DecisionSource, IDecisionRecord } from "../types/interview";

export interface CreateDecisionRecordInput {
  sessionId: number;
  key: string;
  value: unknown;
  source: DecisionSource;
}

export class DecisionRecordModel extends BaseModel {
  protected static tableName = "decision_record";
  protected static jsonFields = ["value"];

  static async create(
    input: CreateDecisionRecordInput,
    trx?: QueryContext,
  ): Promise<IDecisionRecord> {
    const [row] = await this.table(trx)
      .insert(
        this.serializeJsonFields({
          session_id: input.sessionId,
          key: input.key,
          value: input.value,
          source: input.source,
        }),
      )
      .returning("*");
    return this.deserializeJsonFields(row as Record<string, unknown>) as unknown as IDecisionRecord;
  }

  /**
   * Insert many decisions at once (one per answered question). Used inside the
   * write-through transaction so a turn's answers and their decision rows are
   * durable together (§10.5). No-op on an empty list. Caller passes the trx.
   */
  static async createMany(
    inputs: CreateDecisionRecordInput[],
    trx?: QueryContext,
  ): Promise<IDecisionRecord[]> {
    if (inputs.length === 0) return [];
    const rows = await this.table(trx)
      .insert(
        inputs.map((input) =>
          this.serializeJsonFields({
            session_id: input.sessionId,
            key: input.key,
            value: input.value,
            source: input.source,
          }),
        ),
      )
      .returning("*");
    return (rows as Record<string, unknown>[]).map(
      (row) => this.deserializeJsonFields(row) as unknown as IDecisionRecord,
    );
  }

  /** All decisions for a session, in insertion order. */
  static async listBySession(
    sessionId: number,
    trx?: QueryContext,
  ): Promise<IDecisionRecord[]> {
    const rows = await this.table(trx)
      .where({ session_id: sessionId })
      .orderBy("created_at", "asc");
    return (rows as Record<string, unknown>[]).map(
      (row) => this.deserializeJsonFields(row) as unknown as IDecisionRecord,
    );
  }
}
