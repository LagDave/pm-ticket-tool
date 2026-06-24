/**
 * React Query hooks for the sessions domain (§14.3, §15.1). Data-fetching lives
 * here, not inline in components. Each hook calls the api/ domain function, then
 * surfaces errors through the shared toast (§16.3). Server state is React Query,
 * never mirrored into useState (§15.1).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cloneSession,
  createSession,
  getSession,
  getSessionState,
  listSessions,
  triageSession,
} from "../../api/sessions";
import type { ApiError } from "../../api";
import { QUERY_KEYS } from "../../lib/queryClient";
import { toast } from "../../lib/toast";
import type {
  CreateSessionInput,
  InterviewSession,
  InterviewState,
  ListSessionsParams,
  PaginatedResult,
  TriageOutcome,
} from "../../types/interview";

/** The bare prefix all paginated session-list keys share — for broad invalidation. */
const SESSIONS_KEY_PREFIX = ["sessions"] as const;

/** Fetch a single session by id; disabled until an id is present. */
export function useSession(id: number | null) {
  return useQuery({
    queryKey: QUERY_KEYS.session(id ?? 0),
    queryFn: () => getSession(id as number),
    enabled: id !== null && id > 0,
  });
}

/**
 * The dashboard's paginated session list (spec 4 T1/T4). Keyed by params so each
 * page/filter caches separately; keeps the previous page on screen while the next
 * loads so paging doesn't flash empty.
 */
export function useSessions(params: ListSessionsParams = {}) {
  return useQuery<PaginatedResult<InterviewSession>, ApiError>({
    queryKey: QUERY_KEYS.sessions(params),
    queryFn: () => listSessions(params),
    placeholderData: (prev) => prev,
  });
}

/**
 * The resume state for a session (spec 4 T2/T5): turns + decisions + status +
 * ticketId, replayed to rebuild the wizard position. Disabled until an id is
 * present so the dashboard can fetch on demand when the PM opens a row.
 */
export function useResume(id: number | null) {
  return useQuery<InterviewState, ApiError>({
    queryKey: QUERY_KEYS.sessionState(id ?? 0),
    queryFn: () => getSessionState(id as number),
    enabled: id !== null && id > 0,
  });
}

/** Create a session, seed its cache, and surface failures via toast (§16.1/§16.3). */
export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation<InterviewSession, ApiError, CreateSessionInput>({
    mutationFn: (input) => createSession(input),
    onSuccess: (session) => {
      queryClient.setQueryData(QUERY_KEYS.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY_PREFIX });
    },
    onError: (error) => {
      toast.error(error.message || "Could not create the session.");
    },
  });
}

/**
 * Triage a session after request entry (spec 7 T3): classify the request and get
 * the route to take. Server state via React Query (§15.1), not a ref-guarded
 * effect+mutation — so the outcome reliably lands on the mounted instance even
 * under React StrictMode's dev double-mount (the old mutation skipped its
 * surviving instance and hung the UI). The query is enabled once a session id is
 * present and calls the IDEMPOTENT triage endpoint, which classifies once then
 * returns the persisted label on any re-fetch/re-mount, so a double-invoke is
 * cheap and stable. The backend defaults to `scoped` on a model failure, so this
 * rarely errors; when it does (e.g. a network drop) the component renders its
 * retry panel off `isError` and `refetch` re-runs the (now cheap) call.
 */
export function useTriageSession(sessionId: number | null) {
  return useQuery<TriageOutcome, ApiError>({
    queryKey: QUERY_KEYS.triage(sessionId ?? 0),
    queryFn: () => triageSession(sessionId as number),
    enabled: sessionId !== null && sessionId > 0,
    // The label is persisted server-side after the first run; don't auto-expire
    // it and re-hit the model seam while the PM sits on the branch screen.
    staleTime: Infinity,
  });
}

/**
 * Re-run a prior session as a fresh clone (spec 4 T3). Invalidates every list
 * page so the new session shows, seeds its own cache, and toasts success/failure.
 */
export function useCloneSession() {
  const queryClient = useQueryClient();
  return useMutation<InterviewSession, ApiError, number>({
    mutationFn: (sourceId) => cloneSession(sourceId),
    onSuccess: (session) => {
      queryClient.setQueryData(QUERY_KEYS.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY_PREFIX });
      toast.success("Re-run created as a fresh session.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not re-run the session.");
    },
  });
}
