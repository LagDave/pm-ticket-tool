/**
 * QuestionField — renders one question's options plus an optional free-text
 * "other" input (§12.3, §13.3). Presentational: it reports selection changes up
 * to QuestionBatch, which owns the draft state. No fetch, no business logic.
 *
 * Spec 6 (grounded options): every option shows its build-speed tier as a tag,
 * and the single recommended pick shows a "recommended" marker. Grounded options
 * are advisory, never certified — the surrounding "verify with engineering" note
 * lives in QuestionBatch.
 *
 * NOTE: this is the minimal field/label wiring for the speed scale; a fuller UI
 * pass on these tags is handled separately.
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
 * The chrome for one option: a "recommended" marker on the single best pick, plus
 * the build-speed tag every option carries (spec 6 — speed scale).
 */
function OptionTags({ option }: { option: QuestionOption }) {
  return (
    <span className="option-tags">
      {option.recommended && (
        <span className="option-recommended">Recommended</span>
      )}
      <span className="option-speed">Speed: {option.speed}</span>
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
      {question.options.map((option, index) => {
        // id is optional on the contract; fall back to the index so selection
        // stays stable for options the model returned without one.
        const optionId = option.id ?? String(index);
        return (
          <label key={optionId} className="option-row">
            <input
              type="radio"
              name={question.id}
              checked={selectedOptionId === optionId}
              onChange={() => onSelectOption(optionId)}
              disabled={disabled}
            />
            <span className="option-label">{option.label}</span>
            <OptionTags option={option} />
          </label>
        );
      })}
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
