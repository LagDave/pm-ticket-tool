/**
 * Interview engine domain API - thin typed functions over the one client
 * (§12.1, §14.2). One file per backend domain; never calls axios/fetch directly.
 * Endpoints live under the sessions resource (spec 2 T5).
 */
import { apiGet, apiPost } from "./index";
import type { InterviewState, SubmitAnswersInput } from "../types/interview";

/** GET /sessions/:id/interview - full engine state (turns + decisions + status). */
export async function getInterviewState(
  sessionId: number,
): Promise<InterviewState> {
  return apiGet<InterviewState>(`/sessions/${sessionId}/interview`);
}

/** POST /sessions/:id/interview/next-batch - generate the next batch through the gate. */
export async function advanceNextBatch(
  sessionId: number,
): Promise<InterviewState> {
  return apiPost<InterviewState>(`/sessions/${sessionId}/interview/next-batch`);
}

/** POST /sessions/:id/interview/answers - submit answers to the open batch. */
export async function submitInterviewAnswers(
  sessionId: number,
  input: SubmitAnswersInput,
): Promise<InterviewState> {
  return apiPost<InterviewState>(`/sessions/${sessionId}/interview/answers`, input);
}
