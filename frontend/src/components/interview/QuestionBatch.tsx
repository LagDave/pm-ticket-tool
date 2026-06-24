/**
 * QuestionBatch - wizard step that renders the current open batch and collects
 * answers (§12.3). A component renders + delegates: server state comes from the
 * useInterview hooks (§14.3, §15.1); only the in-progress answer selections are
 * local UI state. The batch is shown ONE QUESTION PER SCREEN via QuestionCarousel
 * (swipe / arrows / clickable dots) rather than a vertical stack - each screen is
 * a question and its full animated OptionDeck (recommended highlighted, neutral
 * build-speed meter). Per-question free-text and the global "stop and generate
 * now" are supported; the primary "submit the batch" action appears once every
 * question is answered. Errors surface via the shared toast in the hooks (§16.3);
 * no fetch or business logic here (§14.1).
 *
 * Batch progress (spec 2 UX): a "Interview · Batch N" header, a stepper of
 * answered batches, and an answered-count make generating batch 2/3 visibly
 * different from batch 1 - it no longer looks like the first Generate screen.
 * The generate button advertises the real next batch number ("Ready for batch
 * N"), generation shows the shared ThinkingLoader, and the deck animates
 * out/in between batches via AnimatePresence keyed on the batch number.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { SPRING_SOFT } from "../../lib/motion";
import {
  useAdvanceNextBatch,
  useInterview,
  useSubmitAnswers,
} from "../../hooks/queries/useInterviewQueries";
import type {
  InterviewQuestion,
  InterviewState,
  SubmittedAnswer,
} from "../../types/interview";
import {
  answeredBatchCount,
  currentBatchNumber,
  generateButtonLabel,
  hasOpenBatch,
} from "../../utils/batchProgress";
import { ThinkingLoader } from "../ui/ThinkingLoader";
import { OTHER_OPTION } from "./OptionDeck";
import { QuestionCarousel } from "./QuestionCarousel";

interface QuestionBatchProps {
  sessionId: number;
  /** Called when the interview reaches a terminal state. */
  onComplete: (state: InterviewState) => void;
}

/** A single in-progress selection: a chosen option id, or free-text. */
interface Draft {
  optionId: string | null;
  otherText: string;
}

/**
 * True when a draft is a usable answer: a picked option, or "Other" with non-empty
 * text. Single source of truth for both the per-question dot state (carousel) and
 * the batch-level "all answered" gate (§4.3 - don't duplicate the rule).
 */
function draftIsAnswered(draft: Draft | undefined): boolean {
  if (!draft) return false;
  if (draft.optionId === OTHER_OPTION) return draft.otherText.trim().length > 0;
  return draft.optionId !== null;
}

/** Find the open batch: the last turn whose answers are still null. */
function openQuestions(state: InterviewState | undefined): InterviewQuestion[] {
  if (!state || state.turns.length === 0) return [];
  const last = state.turns[state.turns.length - 1];
  return last.answers === null ? last.questions.questions : [];
}

/**
 * True when any option in the open batch is grounded in scout findings (spec 6):
 * it carries a groundingRef back to a finding. Drives the "verify with engineering"
 * note - shown only when there is grounding to verify.
 */
function hasGroundedOptions(questions: InterviewQuestion[]): boolean {
  return questions.some((question) =>
    question.options.some((option) => Boolean(option.groundingRef)),
  );
}

/**
 * Auto-advance between batches (Rev 2). Once a batch is answered - or a resumed
 * session sits answered with no open batch - generate the next batch with no
 * manual "Ready for batch N" button. Fires `onAdvance` once per answered count
 * (ref guard); batch 1 stays user-initiated (answered === 0 is skipped). The
 * engine returns the next batch's questions or a completed interview, so the view
 * flips straight to questions or the ticket.
 */
function useAutoAdvanceBatches(
  answered: number,
  isOpen: boolean,
  isComplete: boolean,
  isBusy: boolean,
  onAdvance: () => void,
): void {
  const autoAdvancedFor = useRef<number | null>(null);
  useEffect(() => {
    if (isComplete || isOpen || answered === 0 || isBusy) return;
    if (autoAdvancedFor.current === answered) return;
    autoAdvancedFor.current = answered;
    onAdvance();
  }, [answered, isOpen, isComplete, isBusy, onAdvance]);
}

export function QuestionBatch({ sessionId, onComplete }: QuestionBatchProps) {
  const { data: state, isLoading } = useInterview(sessionId);
  const advance = useAdvanceNextBatch(sessionId);
  const submit = useSubmitAnswers(sessionId);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const questions = useMemo(() => openQuestions(state), [state]);
  const isGrounded = useMemo(() => hasGroundedOptions(questions), [questions]);
  const isBusy = advance.isPending || submit.isPending;

  const answered = answeredBatchCount(state);
  const batchNumber = currentBatchNumber(state);
  const isOpen = hasOpenBatch(state);
  const isComplete = state?.isComplete ?? false;

  // Selection is mutually exclusive (Item 8): picking a real option clears any
  // custom free-text, and engaging the custom card selects it (clearing any
  // picked option). Picking an option clears the custom text; engaging the custom
  // field makes it the active selection and keeps it selected while in use.
  const setOption = (questionId: string, optionId: string): void => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { optionId, otherText: "" },
    }));
  };
  // Focusing the custom field makes it the active selection right away (Item 1):
  // the custom card highlights and the previously picked option de-highlights,
  // before any text is typed. It stays selected while engaged; an empty custom
  // card reads selected but is "not answered" (draftIsAnswered gates submit).
  const selectOther = (questionId: string): void => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { optionId: OTHER_OPTION, otherText: prev[questionId]?.otherText ?? "" },
    }));
  };
  const setOther = (questionId: string, otherText: string): void => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { optionId: OTHER_OPTION, otherText },
    }));
  };

  const toAnswers = (): SubmittedAnswer[] =>
    questions.map((q) => {
      const draft = drafts[q.id];
      if (draft && draft.optionId === OTHER_OPTION) {
        return { questionId: q.id, optionId: null, otherText: draft.otherText.trim() };
      }
      return { questionId: q.id, optionId: draft?.optionId ?? null, otherText: null };
    });

  const allAnswered = questions.every((q) => draftIsAnswered(drafts[q.id]));
  const isAnswered = (questionId: string): boolean =>
    draftIsAnswered(drafts[questionId]);

  // Flatten the drafts into the two id-keyed maps the carousel reads (it stays
  // presentational; the parent keeps owning the draft state). Memoized so the
  // carousel doesn't see a fresh object identity on every unrelated render.
  const selectedByQuestion = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const q of questions) map[q.id] = drafts[q.id]?.optionId ?? null;
    return map;
  }, [questions, drafts]);
  const otherByQuestion = useMemo(() => {
    const map: Record<string, string> = {};
    for (const q of questions) map[q.id] = drafts[q.id]?.otherText ?? "";
    return map;
  }, [questions, drafts]);

  const finishIfComplete = (next: InterviewState): void => {
    if (next.isComplete) onComplete(next);
    else setDrafts({});
  };

  const handleSubmit = (stopAndGenerate: boolean): void => {
    submit.mutate(
      { answers: toAnswers(), stopAndGenerate },
      { onSuccess: (next) => finishIfComplete(next) },
    );
  };

  const handleGenerate = (): void => {
    advance.mutate(undefined, {
      onSuccess: (next) => {
        if (next.isComplete) onComplete(next);
      },
    });
  };

  // Auto-advance between batches (Rev 2): no manual "Ready for batch N" button - a
  // submitted batch (or a resumed answered session) generates the next batch, which
  // the engine returns as more questions or a completed interview. handleGenerate
  // already advances + completes, so it is the trigger.
  useAutoAdvanceBatches(answered, isOpen, isComplete, isBusy, handleGenerate);

  if (isLoading) return <ThinkingLoader subtitle="Loading your feature scope" />;

  // Generating a batch - show the shared ThinkingLoader. Rendered directly (no
  // wrapping AnimatePresence): the loader owns its own internal AnimatePresence
  // for the rotating messages, and wrapping it in a second mode="wait" presence
  // here deadlocks its exit when the batch lands, leaving the loader stuck on
  // screen. React swaps the trees cleanly without it. Batch 1 names itself; later
  // batches auto-advance (we don't yet know if more are coming), so stay neutral.
  if (advance.isPending) {
    return (
      <ThinkingLoader
        subtitle={answered === 0 ? "Preparing the first batch" : "Reviewing your answers"}
      />
    );
  }

  // No open batch. Batch 1 is user-initiated (the Start panel). Between batches we
  // auto-advance (the effect above), so show the loader instead of a "Ready for
  // batch N" button - the next render is the new batch's questions or the ticket.
  if (!isOpen || questions.length === 0) {
    if (answered === 0) {
      return (
        <GenerateBatchPanel
          answered={answered}
          label={generateButtonLabel(state)}
          disabled={isBusy}
          onGenerate={handleGenerate}
        />
      );
    }
    return <ThinkingLoader subtitle="Reviewing your answers" />;
  }

  return (
    <AnimatePresence mode="wait">
      <OpenBatchView
        key={batchNumber}
        answered={answered}
        batchNumber={batchNumber}
        questions={questions}
        selectedByQuestion={selectedByQuestion}
        otherByQuestion={otherByQuestion}
        isAnswered={isAnswered}
        isGrounded={isGrounded}
        isBusy={isBusy}
        isSaving={submit.isPending}
        allAnswered={allAnswered}
        onSelectOption={setOption}
        onSelectOther={selectOther}
        onChangeOther={setOther}
        onSubmit={handleSubmit}
      />
    </AnimatePresence>
  );
}

/**
 * The open-batch view: the progress header, the prompt, the grounding note, the
 * one-question-per-screen carousel, and the submit / stop actions. Extracted so
 * the parent is a lean orchestrator (§13.2); it animates in/out (keyed on the
 * batch number by the parent) so a new batch visibly arrives. Presentational -
 * the parent owns the draft state and the mutations.
 */
function OpenBatchView({
  answered,
  batchNumber,
  questions,
  selectedByQuestion,
  otherByQuestion,
  isAnswered,
  isGrounded,
  isBusy,
  isSaving,
  allAnswered,
  onSelectOption,
  onSelectOther,
  onChangeOther,
  onSubmit,
}: {
  answered: number;
  batchNumber: number;
  questions: InterviewQuestion[];
  selectedByQuestion: Record<string, string | null>;
  otherByQuestion: Record<string, string>;
  isAnswered: (questionId: string) => boolean;
  isGrounded: boolean;
  isBusy: boolean;
  isSaving: boolean;
  allAnswered: boolean;
  onSelectOption: (questionId: string, optionId: string) => void;
  onSelectOther: (questionId: string) => void;
  onChangeOther: (questionId: string, otherText: string) => void;
  onSubmit: (stopAndGenerate: boolean) => void;
}) {
  return (
    <motion.section
      className="step-panel"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
      exit={{ opacity: 0, y: -14, transition: { duration: 0.18 } }}
    >
      <BatchProgress answered={answered} current={batchNumber} />
      <h2 className="step-heading">A few questions</h2>
      <p className="field-hint">
        One at a time. Swipe or use the arrows and dots to move between them.
        Answer what you can; when you have enough, stop and we&apos;ll draft the
        ticket.
      </p>
      {isGrounded && (
        <p className="field-hint grounding-note">
          Some options are grounded in a scan of your codebase and tagged with a
          rough build-speed tier. These are orientation only. Verify with
          engineering before committing.
        </p>
      )}

      <QuestionCarousel
        questions={questions}
        selectedByQuestion={selectedByQuestion}
        otherByQuestion={otherByQuestion}
        isAnswered={isAnswered}
        disabled={isBusy}
        canSubmit={allAnswered && !isBusy}
        onSelectOption={onSelectOption}
        onSelectOther={onSelectOther}
        onChangeOther={onChangeOther}
        onSubmit={() => onSubmit(false)}
      />

      <div className="step-actions is-end">
        <button
          type="button"
          className="primary-button"
          onClick={() => onSubmit(false)}
          disabled={!allAnswered || isBusy}
        >
          {isSaving ? "Saving…" : "Submit answers"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onSubmit(true)}
          disabled={!allAnswered || isBusy}
        >
          Stop and draft the ticket
        </button>
      </div>
    </motion.section>
  );
}

/**
 * The batch-progress header: an "Interview · Batch N" eyebrow, an answered count,
 * and a stepper of pips (one filled per answered batch, the current one
 * highlighted). Kept local + presentational so the parent stays lean (§13.2).
 */
function BatchProgress({
  answered,
  current,
}: {
  answered: number;
  /** The 1-indexed batch on screen, or null when none is open (between batches). */
  current: number | null;
}) {
  // Show a pip per answered batch plus the current one if it's a fresh open batch.
  const pipCount = Math.max(answered + (current && current > answered ? 1 : 0), 1);
  const pips = Array.from({ length: pipCount }, (_, i) => i + 1);

  return (
    <div>
      <div className="batch-bar">
        <p className="batch-eyebrow">
          Feature Scope
          {current !== null && (
            <>
              {" · "}
              <span className="batch-n">Batch {current}</span>
            </>
          )}
        </p>
        <span className="batch-count">
          {answered === 0
            ? "No batches answered yet"
            : `${answered} ${answered === 1 ? "batch" : "batches"} answered`}
        </span>
      </div>
      <div
        className="batch-stepper"
        role="img"
        aria-label={`${answered} of ${pipCount} batches answered`}
      >
        {pips.map((n) => (
          <span
            key={n}
            className={
              "batch-pip" +
              (n <= answered ? " is-answered" : "") +
              (current !== null && n === current ? " is-current" : "")
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The between-batches screen: progress so far plus the generate control whose
 * label advertises the real next batch number. Extracted to keep the parent
 * component lean (§13.2). Presentational; the parent owns the mutation.
 */
function GenerateBatchPanel({
  answered,
  label,
  disabled,
  onGenerate,
}: {
  answered: number;
  label: string;
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <motion.section
      className="step-panel"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
    >
      <BatchProgress answered={answered} current={null} />
      <h2 className="step-heading">
        {answered === 0 ? "Ready when you are" : `Batch ${answered} answered`}
      </h2>
      <p className="field-hint">
        {answered === 0
          ? "We'll ask a few dependency-ordered questions at a time, grounded in your request, and stop once there's enough to draft a good ticket."
          : "Nice, those are saved. Generate the next batch, or stop here and draft the ticket from what we have."}
      </p>
      <div className="step-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onGenerate}
          disabled={disabled}
        >
          {label}
        </button>
      </div>
    </motion.section>
  );
}
