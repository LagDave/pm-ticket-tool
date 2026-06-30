/**
 * Shared React Query client + the canonical query-key registry (§15.1). Server
 * state lives in React Query, never mirrored into useState. Keys are centralized
 * so hooks and invalidations agree.
 */
import { QueryClient } from "@tanstack/react-query";
import type { ListSessionsParams } from "../types/interview";

/** Default cache freshness. Named, not magic. */
const STALE_TIME_MS = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const QUERY_KEYS = {
  session: (id: number) => ["session", id] as const,
  /**
   * The dashboard list (spec 4). Keyed by the page/limit/status params so each
   * page and filter caches separately; the bare prefix is used for broad
   * invalidation after a create/clone.
   */
  sessions: (params: ListSessionsParams = {}) =>
    [
      "sessions",
      params.page ?? null,
      params.limit ?? null,
      params.status ?? null,
      params.search ?? null,
    ] as const,
  /** Resume state for a session (spec 4 T2): turns + decisions + status + ticketId. */
  sessionState: (id: number) => ["session-state", id] as const,
  /** The two-speed triage outcome for a session (spec 7): the persisted label + route. */
  triage: (sessionId: number) => ["triage", sessionId] as const,
  /** Engine state for a session (spec 2): turns + decisions + status. */
  interview: (sessionId: number) => ["interview", sessionId] as const,
  /** A persisted ticket + its comments (spec 3), keyed by ticket id. */
  ticket: (ticketId: number) => ["ticket", ticketId] as const,
  /** The owner's projects list (project context grounding). The bare prefix is
   *  used for broad invalidation after a create/delete. */
  projects: () => ["projects"] as const,
  /** One project + its bits, keyed by project id (project context grounding). */
  project: (id: number) => ["project", id] as const,
  /** The server-owned generate-bits prompt for a project (project context grounding). */
  bitPrompt: (id: number) => ["bit-prompt", id] as const,
  /** The public read-only shared ticket (spec What), keyed by its share token. */
  sharedTicket: (token: string) => ["shared-ticket", token] as const,
};
