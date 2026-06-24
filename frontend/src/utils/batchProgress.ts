/**
 * Pure helpers for the interview's batch progress (spec 2 - interview engine).
 * The engine state exposes `turns[]` where each turn is one generated batch
 * (`turn_index` is 0-based, so the human batch number = turn_index + 1) and
 * `answers` is null until the PM has answered that batch. These helpers turn
 * that raw state into the numbers the UI shows - current batch, how many are
 * answered, and the next batch number the generate button advertises - so the
 * component stays lean (§13.2) and the math is unit-checkable. Framework-free,
 * typed, no `any` (§17.2).
 */
import type { InterviewState } from "../types/interview";

/** How many batches have been answered (a turn with a non-null `answers`). */
export function answeredBatchCount(state: InterviewState | undefined): number {
  if (!state) return 0;
  return state.turns.filter((turn) => turn.answers !== null).length;
}

/**
 * The 1-indexed number of the batch currently shown. When an open (unanswered)
 * batch exists it is the last turn's number; otherwise - between batches, before
 * the next one is generated - it is the count of turns so far (0 before any).
 */
export function currentBatchNumber(state: InterviewState | undefined): number {
  if (!state || state.turns.length === 0) return 0;
  return state.turns.length;
}

/** True when the last turn has no answers yet - there is a batch to answer now. */
export function hasOpenBatch(state: InterviewState | undefined): boolean {
  if (!state || state.turns.length === 0) return false;
  return state.turns[state.turns.length - 1].answers === null;
}

/**
 * The 1-indexed number of the NEXT batch the generate button will fetch. With an
 * open batch this is moot (the button submits, it doesn't generate), so it is
 * used only on the no-open-batch path: the answered count + 1. Internal to the
 * button label below - not exported, to avoid a dead public export.
 */
function nextBatchNumber(state: InterviewState | undefined): number {
  return answeredBatchCount(state) + 1;
}

/**
 * The label for the generate button, reflecting the real next batch number
 * (the user's phrasing): "Start" before the first batch, "Ready for batch N"
 * once at least one batch has been answered.
 */
export function generateButtonLabel(state: InterviewState | undefined): string {
  const next = nextBatchNumber(state);
  return next === 1 ? "Start feature scoping" : `Ready for batch ${next}`;
}
