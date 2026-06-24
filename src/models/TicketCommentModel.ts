/**
 * TicketCommentModel — all DB access for ticket_comments (§7.4). A comment is
 * always reached through its parent ticket, which the service owner-verifies via
 * TicketModel.findByIdForOwner before any comment read/write (§11.7). So these
 * methods take a ticketId the caller has already owner-verified. Mirrors the
 * gbp-automation model skeleton (§6.1).
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type { ITicketComment } from "../types/interview";

/** Fields written when a PM adds a comment (spec T3). author comes from server context (§5.5). */
export interface CreateTicketCommentInput {
  ticketId: number;
  authorUserId: number;
  body: string;
}

export class TicketCommentModel extends BaseModel {
  protected static tableName = "ticket_comments";

  /** Insert a comment on a ticket. Caller owner-verifies the ticket first. */
  static async create(
    input: CreateTicketCommentInput,
    trx?: QueryContext,
  ): Promise<ITicketComment> {
    const [row] = await this.table(trx)
      .insert({
        ticket_id: input.ticketId,
        author_user_id: input.authorUserId,
        body: input.body,
      })
      .returning("*");
    return row as ITicketComment;
  }

  /** All comments for a ticket, oldest first. Caller owner-verifies the ticket. */
  static async listByTicket(
    ticketId: number,
    trx?: QueryContext,
  ): Promise<ITicketComment[]> {
    const rows = await this.table(trx)
      .where({ ticket_id: ticketId })
      .orderBy("created_at", "asc");
    return rows as ITicketComment[];
  }
}
