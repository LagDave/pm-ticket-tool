/**
 * Ticket domain API - thin typed functions over the one client (§12.1, §14.2).
 * One file per backend domain; never calls axios/fetch directly. Generation
 * hangs off the session resource; reads/edits address the ticket resource (spec 3).
 * The public share read (spec What) is unauthenticated but still goes through the
 * one client, so error unwrapping stays consistent (§16.1).
 */
import { apiGet, apiPatch, apiPost } from "./index";
import type {
  AddCommentInput,
  FinalizeTicketInput,
  PublicTicket,
  Ticket,
  TicketComment,
  TicketWithComments,
  UpdateTicketInput,
} from "../types/ticket";

/** POST /sessions/:id/ticket - generate a draft ticket from the session → the new ticket. */
export async function generateTicket(sessionId: number): Promise<Ticket> {
  return apiPost<Ticket>(`/sessions/${sessionId}/ticket`);
}

/** GET /tickets/:id - the ticket plus its comments. */
export async function getTicket(ticketId: number): Promise<TicketWithComments> {
  return apiGet<TicketWithComments>(`/tickets/${ticketId}`);
}

/** GET /shared/tickets/:token - the public read-only ticket projection (no auth, spec What). */
export async function getSharedTicket(token: string): Promise<PublicTicket> {
  return apiGet<PublicTicket>(`/shared/tickets/${encodeURIComponent(token)}`);
}

/** PATCH /tickets/:id - inline edit, version-guarded → the updated ticket + comments. */
export async function updateTicket(
  ticketId: number,
  input: UpdateTicketInput,
): Promise<TicketWithComments> {
  return apiPatch<TicketWithComments>(`/tickets/${ticketId}`, input);
}

/** POST /tickets/:id/comments - add a comment → the new comment. */
export async function addTicketComment(
  ticketId: number,
  input: AddCommentInput,
): Promise<TicketComment> {
  return apiPost<TicketComment>(`/tickets/${ticketId}/comments`, input);
}

/** POST /tickets/:id/finalize - flip draft→final, bump version → the finalized ticket + comments. */
export async function finalizeTicket(
  ticketId: number,
  input: FinalizeTicketInput,
): Promise<TicketWithComments> {
  return apiPost<TicketWithComments>(`/tickets/${ticketId}/finalize`, input);
}
