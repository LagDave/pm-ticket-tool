/**
 * React Query hooks for the interview engine (§14.3, §15.1). Data-fetching
 * lives here, not inline in components. Each hook calls the api/ domain
 * function, then surfaces errors through the shared toast (§16.3). Mutations
 * seed the engine-state cache from their response so the wizard advances
 * without an extra round-trip.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  advanceNextBatch,
  getInterviewState,
  overrideSkippedQuestion,
  submitInterviewAnswers,
} from "../../api/interview";
import type { ApiError } from "../../api";
import { QUERY_KEYS } from "../../lib/queryClient";
import { toast } from "../../lib/toast";
import type { InterviewState, SubmitAnswersInput } from "../../types/interview";

/** Fetch the engine state for a session; disabled until an id is present. */
export function useInterview(sessionId: number | null) {
  return useQuery({
    queryKey: QUERY_KEYS.interview(sessionId ?? 0),
    queryFn: () => getInterviewState(sessionId as number),
    enabled: sessionId !== null && sessionId > 0,
  });
}

/** Generate the next batch through the materiality gate; surface failures via toast. */
export function useAdvanceNextBatch(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<InterviewState, ApiError, void>({
    mutationFn: () => advanceNextBatch(sessionId as number),
    onSuccess: (state) => {
      queryClient.setQueryData(QUERY_KEYS.interview(state.sessionId), state);
    },
    onError: (error) => {
      toast.error(error.message || "Could not generate the next batch.");
    },
  });
}

/** Submit answers to the open batch (optionally stopping); surface failures via toast. */
export function useSubmitAnswers(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<InterviewState, ApiError, SubmitAnswersInput>({
    mutationFn: (input) => submitInterviewAnswers(sessionId as number, input),
    onSuccess: (state) => {
      queryClient.setQueryData(QUERY_KEYS.interview(state.sessionId), state);
    },
    onError: (error) => {
      toast.error(error.message || "Could not submit your answers.");
    },
  });
}

/** Override a question the grounding suppressed (spec R3); surface failures via toast. */
export function useOverrideSkipped(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<InterviewState, ApiError, { decisionKey: string; answer: string }>({
    mutationFn: (input) => overrideSkippedQuestion(sessionId as number, input),
    onSuccess: (state) => {
      queryClient.setQueryData(QUERY_KEYS.interview(state.sessionId), state);
    },
    onError: (error) => {
      toast.error(error.message || "Could not record your answer.");
    },
  });
}
