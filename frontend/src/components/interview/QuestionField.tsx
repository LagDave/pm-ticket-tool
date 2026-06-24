/**
 * QuestionField — renders one question's options plus an optional free-text
 * "other" input (§12.3, §13.3). Presentational: it reports selection changes up
 * to QuestionBatch, which owns the draft state. No fetch, no business logic.
 *
 * Spec 6 (grounded options): when an option is grounded in scout findings it
 * shows its effort tier as a tag and, for the single recommended pick, a
 * "recommended" marker. Grounded options are advisory, never certified — the
 * surrounding "verify with engineering" note lives in QuestionBatch.
 */
import type { InterviewQuestion, QuestionOption } from "../../types/interview";

export const OTHER_OPTION = "__other__";

interface QuestionFieldProps {
  question: InterviewQuestion;
  /** Currently selected option id (or OTHER_OPTION), if any. */
  selectedOptionId: string | null;
  otherText: string;
  disabled: boolean;
  onSelectOption: (optionId: string) => void;
  onChangeOther: (otherText: string) => void;
}

/**
 * The grounded chrome for one option: the recommended marker and the effort tag,
 * each rendered only when the field is set (both null on the ungrounded path, so
 * an ungrounded option renders exactly as before).
 */
function OptionTags({ option }: { option: QuestionOption }) {
  if (!option.recommended && option.effort === null) return null;
  return (
    <span className="option-tags">
      {option.recommended === true && (
        <span className="option-recommended">Recommended</span>
      )}
      {option.effort !== null && (
        <span className="option-effort">Effort {option.effort}</span>
      )}
    </span>
  );
}

export function QuestionField({
  question,
  selectedOptionId,
  otherText,
  disabled,
  onSelectOption,
  onChangeOther,
}: QuestionFieldProps) {
  return (
    <fieldset className="question-card">
      <legend className="field-label">{question.text}</legend>
      {question.options.map((option) => (
        <label key={option.id} className="option-row">
          <input
            type="radio"
            name={question.id}
            checked={selectedOptionId === option.id}
            onChange={() => onSelectOption(option.id)}
            disabled={disabled}
          />
          <span className="option-label">{option.label}</span>
          <OptionTags option={option} />
        </label>
      ))}
      {question.allowOther && (
        <label className="option-row">
          <input
            type="radio"
            name={question.id}
            checked={selectedOptionId === OTHER_OPTION}
            onChange={() => onChangeOther(otherText)}
            disabled={disabled}
          />
          <input
            type="text"
            className="request-input"
            placeholder="Other (describe)…"
            value={otherText}
            onChange={(event) => onChangeOther(event.target.value)}
            disabled={disabled}
          />
        </label>
      )}
    </fieldset>
  );
}
