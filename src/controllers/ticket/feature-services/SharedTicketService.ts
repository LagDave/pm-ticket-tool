/**
 * SharedTicketService — the public, read-only share path for a ticket (spec What,
 * §7.1). Looks a ticket up by its capability token (no owner scope — the token IS
 * the authorization, see TicketModel.findByShareToken) and maps it to a content-
 * only PublicTicket that leaks nothing internal (§5.4, §5.5). Raises a typed
 * TicketError on a miss. Never touches req/res. Sibling to TicketService (§6.1).
 */
import { TicketModel } from "../../../models/TicketModel";
import type { ITicket, PublicTicket } from "../../../types/interview";
import { TicketError } from "../feature-utils/TicketError";

export class SharedTicketService {
  /**
   * Resolve a share token to its public ticket projection (spec What). Throws
   * SHARED_TICKET_NOT_FOUND (→ 404) when no ticket matches — an unknown or stale
   * token is indistinguishable from a never-existed one, so the link never reveals
   * whether a ticket exists (§5.4).
   */
  static async getByToken(token: string): Promise<PublicTicket> {
    const ticket = await TicketModel.findByShareToken(token);
    if (!ticket) {
      throw new TicketError(
        "SHARED_TICKET_NOT_FOUND",
        "No shared ticket matches this link.",
        null,
      );
    }
    return this.toPublic(ticket);
  }

  /**
   * Project a ticket row to the content-only public shape. Deliberately drops id,
   * session_id, share_token, and never reads comments — the public surface is
   * ticket content and nothing else (§5.4, §5.5).
   */
  private static toPublic(ticket: ITicket): PublicTicket {
    return {
      user_story: ticket.user_story,
      acceptance_criteria: ticket.acceptance_criteria,
      effort: ticket.effort,
      priority: ticket.priority,
      context_summary: ticket.context_summary,
      details: ticket.details,
      status: ticket.status,
      version: ticket.version,
      rendered_markdown: ticket.rendered_markdown,
      created_at: ticket.created_at,
    };
  }
}
