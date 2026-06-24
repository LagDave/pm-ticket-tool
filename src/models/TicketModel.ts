/**
 * TicketModel — all DB access for tickets (§7.4). A ticket is always reached
 * through its parent interview_session, so every read/write is owner-scoped by
 * joining tickets → interview_sessions and filtering on the server-derived
 * owner_user_id (§11.7, §5.5). A query that could return another owner's ticket
 * is a data leak, not a bug. Mirrors InterviewSessionModel's owner-scope shape
 * and the gbp-automation model skeleton (§6.1).
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type {
  AcceptanceCriterion,
  EffortTier,
  ITicket,
  OwnerContext,
} from "../types/interview";

/** Fields written when a generated ticket is first persisted (spec T1/T2). */
export interface CreateTicketInput {
  sessionId: number;
  userStory: string;
  acceptanceCriteria: AcceptanceCriterion[];
  effort: EffortTier;
  contextSummary: string;
  renderedMarkdown: string;
}

/** Editable fields for an inline PATCH (spec T3). All optional — only set ones change. */
export interface UpdateTicketInput {
  userStory?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  effort?: EffortTier;
  contextSummary?: string;
  /** Re-rendered Markdown for the edited fields (recomputed by the service, §7.1). */
  renderedMarkdown?: string;
}

export class TicketModel extends BaseModel {
  protected static tableName = "tickets";
  protected static jsonFields = ["acceptance_criteria"];

  /** Insert a generated ticket for a session. Caller owner-verifies the session first. */
  static async create(
    input: CreateTicketInput,
    trx?: QueryContext,
  ): Promise<ITicket> {
    const [row] = await this.table(trx)
      .insert(
        this.serializeJsonFields({
          session_id: input.sessionId,
          user_story: input.userStory,
          acceptance_criteria: input.acceptanceCriteria,
          effort: input.effort,
          context_summary: input.contextSummary,
          rendered_markdown: input.renderedMarkdown,
          status: "draft",
          version: 1,
        }),
      )
      .returning("*");
    return this.deserialize(row);
  }

  /**
   * Fetch one ticket by id, scoped to the owner via its session. Returns null
   * when the ticket does not exist OR belongs to another owner's session — the
   * caller cannot tell the difference, which is the point (§11.7). Selects only
   * the tickets columns so the joined session columns never bleed into ITicket.
   */
  static async findByIdForOwner(
    id: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<ITicket | null> {
    const row = await this.table(trx)
      .join(
        "interview_sessions",
        "interview_sessions.id",
        "tickets.session_id",
      )
      .where("tickets.id", id)
      .where("interview_sessions.owner_user_id", owner.ownerUserId)
      .first("tickets.*");
    return row ? this.deserialize(row) : null;
  }

  /** The latest ticket for a session (highest version), owner-scoped. */
  static async findLatestBySessionForOwner(
    sessionId: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<ITicket | null> {
    const row = await this.table(trx)
      .join(
        "interview_sessions",
        "interview_sessions.id",
        "tickets.session_id",
      )
      .where("tickets.session_id", sessionId)
      .where("interview_sessions.owner_user_id", owner.ownerUserId)
      .orderBy("tickets.version", "desc")
      .first("tickets.*");
    return row ? this.deserialize(row) : null;
  }

  /**
   * The latest FINAL ticket for a session (highest version among status='final'),
   * owner-scoped (spec T13 — merge-on-complete reads off the finalized ticket).
   * Returns null when the session has no finalized ticket OR belongs to another
   * owner — indistinguishable, never leaked (§11.7, §5.5). Distinct from
   * findLatestBySessionForOwner, which returns the latest of ANY status.
   */
  static async findLatestFinalBySessionForOwner(
    sessionId: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<ITicket | null> {
    const row = await this.table(trx)
      .join(
        "interview_sessions",
        "interview_sessions.id",
        "tickets.session_id",
      )
      .where("tickets.session_id", sessionId)
      .where("tickets.status", "final")
      .where("interview_sessions.owner_user_id", owner.ownerUserId)
      .orderBy("tickets.version", "desc")
      .first("tickets.*");
    return row ? this.deserialize(row) : null;
  }

  /** Tickets for a session, newest version first. Caller owner-verifies the session. */
  static async listBySession(
    sessionId: number,
    trx?: QueryContext,
  ): Promise<ITicket[]> {
    const rows = await this.table(trx)
      .where({ session_id: sessionId })
      .orderBy("version", "desc");
    return (rows as Record<string, unknown>[]).map((row) => this.deserialize(row));
  }

  /**
   * Apply an inline edit guarded by optimistic concurrency (spec Risk:
   * concurrent edits). The update only lands when both the id AND the expected
   * version match; the version is bumped in the same statement. Returns the
   * updated row, or null when no row matched (wrong id or a stale version) —
   * the service maps null to a typed conflict. Owner scope is pre-verified by
   * the service via findByIdForOwner.
   */
  static async updateForOwner(
    id: number,
    expectedVersion: number,
    input: UpdateTicketInput,
    trx?: QueryContext,
  ): Promise<ITicket | null> {
    const patch = this.toUpdatePatch(input);
    const [row] = await this.table(trx)
      .where({ id, version: expectedVersion })
      .update({
        ...this.serializeJsonFields(patch),
        version: expectedVersion + 1,
        updated_at: new Date(),
      })
      .returning("*");
    return row ? this.deserialize(row) : null;
  }

  /**
   * Finalize a ticket: flip status draft→final and bump version, guarded by the
   * expected version (spec T3). Returns the updated row, or null on a stale
   * version / missing id. Owner scope is pre-verified by the service.
   */
  static async finalizeForOwner(
    id: number,
    expectedVersion: number,
    trx?: QueryContext,
  ): Promise<ITicket | null> {
    const [row] = await this.table(trx)
      .where({ id, version: expectedVersion })
      .update({
        status: "final",
        version: expectedVersion + 1,
        updated_at: new Date(),
      })
      .returning("*");
    return row ? this.deserialize(row) : null;
  }

  /** Persist freshly-rendered Markdown for a ticket (spec T5). Owner-scoped by the service. */
  static async setRenderedMarkdown(
    id: number,
    renderedMarkdown: string,
    trx?: QueryContext,
  ): Promise<void> {
    await this.table(trx)
      .where({ id })
      .update({ rendered_markdown: renderedMarkdown, updated_at: new Date() });
  }

  /* ----------------------------- private helpers ------------------------- */

  /** Map the camelCase update input to snake_case columns, omitting undefined fields. */
  private static toUpdatePatch(input: UpdateTicketInput): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (input.userStory !== undefined) patch.user_story = input.userStory;
    if (input.acceptanceCriteria !== undefined) {
      patch.acceptance_criteria = input.acceptanceCriteria;
    }
    if (input.effort !== undefined) patch.effort = input.effort;
    if (input.contextSummary !== undefined) patch.context_summary = input.contextSummary;
    if (input.renderedMarkdown !== undefined) {
      patch.rendered_markdown = input.renderedMarkdown;
    }
    return patch;
  }

  /** Deserialize a raw row into a typed ITicket (JSONB acceptance_criteria parsed). */
  private static deserialize(row: Record<string, unknown>): ITicket {
    return this.deserializeJsonFields(row) as unknown as ITicket;
  }
}
