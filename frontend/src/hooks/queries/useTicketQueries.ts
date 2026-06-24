/**
 * React Query hooks for the ticket domain (§14.3, §15.1). Data-fetching lives
 * here, not inline in components. Each hook calls the api/ domain function, then
 * surfaces errors through the shared toast (§16.3). Mutations seed/refresh the
 * ticket cache from their response so the view updates without an extra
 * round-trip. Mirrors useInterviewQueries.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTicketComment,
  finalizeTicket,
  generateTicket,
  getSharedTicket,
  getTicket,
  updateTicket,
} from "../../api/tickets";
import type { ApiError } from "../../api";
import { QUERY_KEYS } from "../../lib/queryClient";
import { toast } from "../../lib/toast";
import type {
  AddCommentInput,
  Ticket,
  TicketWithComments,
  UpdateTicketInput,
} from "../../types/ticket";

/** Fetch a ticket + its comments; disabled until an id is present. */
export function useTicket(ticketId: number | null) {
  return useQuery({
    queryKey: QUERY_KEYS.ticket(ticketId ?? 0),
    queryFn: () => getTicket(ticketId as number),
    enabled: ticketId !== null && ticketId > 0,
  });
}

/**
 * Fetch the public read-only shared ticket by its token (spec What). Disabled
 * until a token is present. Unauthenticated; powers the deep-link SharedTicketView.
 */
export function useSharedTicket(token: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.sharedTicket(token ?? ""),
    queryFn: () => getSharedTicket(token as string),
    enabled: token !== null && token.length > 0,
  });
}

/** Generate a draft ticket from a session; surface failures via toast. */
export function useGenerateTicket(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<Ticket, ApiError, void>({
    mutationFn: () => generateTicket(sessionId as number),
    onSuccess: (ticket) => {
      // Seed the ticket cache with the fresh draft (no comments yet).
      queryClient.setQueryData<TicketWithComments>(QUERY_KEYS.ticket(ticket.id), {
        ticket,
        comments: [],
      });
    },
    onError: (error) => {
      toast.error(error.message || "Could not generate the ticket.");
    },
  });
}

/** Apply an inline edit (version-guarded); surface conflicts/failures via toast. */
export function useUpdateTicket(ticketId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<TicketWithComments, ApiError, UpdateTicketInput>({
    mutationFn: (input) => updateTicket(ticketId as number, input),
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEYS.ticket(result.ticket.id), result);
    },
    onError: (error) => {
      toast.error(error.message || "Could not save your changes.");
    },
  });
}

/** Add a comment; refresh the ticket so the new comment shows; surface failures via toast. */
export function useAddTicketComment(ticketId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiError, AddCommentInput>({
    mutationFn: (input) => addTicketComment(ticketId as number, input),
    onSuccess: () => {
      if (ticketId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ticket(ticketId) });
      }
    },
    onError: (error) => {
      toast.error(error.message || "Could not add your comment.");
    },
  });
}

/** Finalize the ticket (version-guarded); surface conflicts/failures via toast. */
export function useFinalizeTicket(ticketId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<TicketWithComments, ApiError, number>({
    mutationFn: (expectedVersion) =>
      finalizeTicket(ticketId as number, { expectedVersion }),
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEYS.ticket(result.ticket.id), result);
      toast.success("Ticket finalized.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not finalize the ticket.");
    },
  });
}
