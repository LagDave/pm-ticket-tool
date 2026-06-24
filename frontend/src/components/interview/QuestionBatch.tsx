/**
 * QuestionBatch — wizard step that renders the current open batch and collects
 * answers (§12.3). A component renders + delegates: server state comes from the
 * useInterview hooks (§14.3, §15.1); only the in-progress answer selections are
 * local UI state. Supports per-question free-text "other" and the global
 * "stop and generate now" control. Errors surface via the shared toast in the
 * hooks (§16.3); no fetch or business logic here (§14.1).
 */
import { useMemo, useState } from "react";
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
import { OTHER_OPTION, QuestionField } from "./QuestionField";

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

/** Find the open batch: the last turn whose answers are still null. */
function openQuestions(state: InterviewState | undefined): InterviewQuestion[] {
  if (!state || state.turns.length === 0) return [];
  const last = state.turns[state.turns.length - 1];
  return last.answers === null ? last.questions.questions : [];
}

/**
 * True when any option in the open batch is grounded in scout findings (spec 6):
 * it carries a groundingRef back to a finding. Drives the "verify with engineering"
 * note — shown only when there is grounding to verify. (Speed tiers and the
 * recommended pick are present on every option, grounded or not, so they no longer
 * signal grounding.)
 */
function hasGroundedOptions(questions: InterviewQuestion[]): boolean {
  return questions.some((question) =>
    question.options.some((option) => Boolean(option.groundingRef)),
  );
}

export function QuestionBatch({ sessionId, onComplete }: QuestionBatchProps) {
  const { data: state, isLoading } = useInterview(sessionId);
  const advance = useAdvanceNextBatch(sessionId);
  const submit = useSubmitAnswers(sessionId);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const questions = useMemo(() => openQuestions(state), [state]);
  const isGrounded = useMemo(() => hasGroundedOptions(questions), [questions]);
  const isBusy = advance.isPending || submit.isPending;

  const setOption = (questionId: string, optionId: string): void => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { optionId, otherText: prev[questionId]?.otherText ?? "" },
    }));
  };
  const setOther = (questionId: string, otherText: string): void => {
    setDrafts((prev) => ({ ...prev, [questionId]: { optionId: OTHER_OPTION, otherText } }));
  };

  const toAnswers = (): SubmittedAnswer[] =>
    questions.map((q) => {
      const draft = drafts[q.id];
      if (draft && draft.optionId === OTHER_OPTION) {
        return { questionId: q.id, optionId: null, otherText: draft.otherText.trim() };
      }
      return { questionId: q.id, optionId: draft?.optionId ?? null, otherText: null };
    });

  const allAnswered = questions.every((q) => {
    const draft = drafts[q.id];
    if (!draft) return false;
    if (draft.optionId === OTHER_OPTION) return draft.otherText.trim().length > 0;
    return draft.optionId !== null;
  });

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

  if (isLoading) return <p className="field-hint">Loading interview…</p>;

  // No open batch yet — offer to generate the first/next one.
  if (questions.length === 0) {
    return (
      <section className="step-panel">
        <h2 className="step-heading">Interview</h2>
        <p className="field-hint">
          Generate the next set of questions, grounded in your request.
        </p>
        <div className="step-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleGenerate}
            disabled={isBusy}
          >
            {advance.isPending ? "Generating…" : "Generate questions"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="step-panel">
      <h2 className="step-heading">A few questions</h2>
      <p className="field-hint">
        Answer what you can. When you have enough, stop and we&apos;ll draft the ticket.
      </p>
      {isGrounded && (
        <p className="field-hint grounding-note">
          Some options are grounded in a scan of your codebase and tagged with a rough
          build-speed tier. These are orientation only — verify with engineering before
          committing.
        </p>
      )}

      {questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          selectedOptionId={drafts[question.id]?.optionId ?? null}
          otherText={drafts[question.id]?.otherText ?? ""}
          disabled={isBusy}
          onSelectOption={(optionId) => setOption(question.id, optionId)}
          onChangeOther={(otherText) => setOther(question.id, otherText)}
        />
      ))}

      <div className="step-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => handleSubmit(false)}
          disabled={!allAnswered || isBusy}
        >
          {submit.isPending ? "Saving…" : "Submit answers"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => handleSubmit(true)}
          disabled={!allAnswered || isBusy}
        >
          Stop and generate now
        </button>
      </div>
    </section>
  );
}
