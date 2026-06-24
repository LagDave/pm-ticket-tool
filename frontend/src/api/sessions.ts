/**
 * Sessions domain API - thin typed functions over the one client (§12.1). One
 * file per backend domain; never calls axios/fetch directly (§14.2).
 */
import { apiDelete, apiGet, apiPost } from "./index";
import type {
  CreateSessionInput,
  InterviewSession,
  InterviewState,
  ListSessionsParams,
  PaginatedResult,
  TriageOutcome,
  TriageRequestInput,
} from "../types/interview";

/**
 * POST /sessions - create a session from the request text, optionally attached to
 * a project (input.projectId) so the interview is grounded in that project's bits.
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<InterviewSession> {
  return apiPost<InterviewSession>("/sessions", input);
}

/** GET /sessions/:id - fetch one session the caller owns. */
export async function getSession(id: number): Promise<InterviewSession> {
  return apiGet<InterviewSession>(`/sessions/${id}`);
}

/**
 * GET /sessions - the caller's sessions, paginated + optionally status-filtered
 * (dashboard list, spec 4 T1). Params go through the client's axios config so the
 * one client stays the only fetch path (§14.2).
 */
export async function listSessions(
  params: ListSessionsParams = {},
): Promise<PaginatedResult<InterviewSession>> {
  return apiGet<PaginatedResult<InterviewSession>>("/sessions", { params });
}

/**
 * GET /sessions/:id/state - the resume state (turns + decisions + ticket id) used
 * to rebuild the wizard position (spec 4 T2/T5).
 */
export async function getSessionState(id: number): Promise<InterviewState> {
  return apiGet<InterviewState>(`/sessions/${id}/state`);
}

/** POST /sessions/:id/clone - re-run a prior session as a fresh clone (spec 4 T3). */
export async function cloneSession(id: number): Promise<InterviewSession> {
  return apiPost<InterviewSession>(`/sessions/${id}/clone`);
}

/**
 * DELETE /sessions/:id - permanently delete a session the caller owns. The
 * server cascade also removes its ticket, comments, turns, decisions, and scout
 * rows. Returns the deleted id.
 */
export async function deleteSession(id: number): Promise<{ id: number }> {
  return apiDelete<{ id: number }>(`/sessions/${id}`);
}

/**
 * POST /sessions/:id/triage - classify the request and get the route to take
 * (spec 7 T2). `override` forces the full interview regardless of the label.
 */
export async function triageSession(
  id: number,
  input: TriageRequestInput = {},
): Promise<TriageOutcome> {
  return apiPost<TriageOutcome>(`/sessions/${id}/triage`, input);
}
