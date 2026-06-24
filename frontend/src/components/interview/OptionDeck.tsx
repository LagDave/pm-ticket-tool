/**
 * OptionDeck - one question rendered as an animated deck of option cards (spec 6
 * centerpiece, §12.3). Replaces the old radio list: cards stagger-reveal on entry
 * with spring motion (the container variant), lift on hover, and on select the
 * chosen card expands forward while the others recede/dim (OptionCard). The deck
 * is ordered by build speed - fastest (least effort) first - but the single
 * recommended pick is always pulled to the front so it leads regardless of speed.
 * A distinct dashed "Other (describe)" card keeps the free-text affordance (spec
 * allowOther). Presentational: it reports selection up to QuestionBatch, which
 * owns the draft state. No fetch, no business logic (§14.1). Typed, no any (§17.2).
 */
import { motion } from "framer-motion";
import { Check, PenLine } from "lucide-react";
import { useMemo } from "react";
import { SPRING, SPRING_SOFT, staggerContainer } from "../../lib/motion";
import type { InterviewQuestion, QuestionOption } from "../../types/interview";
import { speedRank } from "../../utils/optionSpeed";
import { OptionCard } from "./OptionCard";

/** The sentinel id used for the free-text "other" choice (shared with QuestionBatch). */
export const OTHER_OPTION = "__other__";

interface OptionDeckProps {
  question: InterviewQuestion;
  /** Currently selected option id (or OTHER_OPTION), if any. */
  selectedOptionId: string | null;
  otherText: string;
  disabled: boolean;
  onSelectOption: (optionId: string) => void;
  onChangeOther: (otherText: string) => void;
}

/** A stable id for an option - falls back to its index when the model omitted one. */
function optionKey(option: QuestionOption, index: number): string {
  return option.id ?? String(index);
}

/**
 * Order the deck: recommended pick first (it leads), then by build speed
 * fastest→slowest (least effort first). Returns [option, stableId] pairs so the
 * caller's selection stays keyed to the original id, not the sorted position.
 */
function orderedOptions(
  question: InterviewQuestion,
): Array<{ option: QuestionOption; id: string }> {
  const withIds = question.options.map((option, index) => ({
    option,
    id: optionKey(option, index),
  }));
  return withIds.sort((a, b) => {
    if (a.option.recommended !== b.option.recommended) {
      return a.option.recommended ? -1 : 1;
    }
    // Higher rank = faster = less effort; show those first.
    return speedRank(b.option.speed) - speedRank(a.option.speed);
  });
}

export function OptionDeck({
  question,
  selectedOptionId,
  otherText,
  disabled,
  onSelectOption,
  onChangeOther,
}: OptionDeckProps) {
  const ordered = useMemo(() => orderedOptions(question), [question]);
  const hasSelection = selectedOptionId !== null;
  const isOtherSelected = selectedOptionId === OTHER_OPTION;

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-5 block font-display text-[1.4rem] font-semibold leading-tight text-ink">
        {question.text}
      </legend>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid gap-3.5 sm:grid-cols-2"
      >
        {ordered.map(({ option, id }) => (
          <OptionCard
            key={id}
            option={option}
            isSelected={selectedOptionId === id}
            isDimmed={hasSelection && selectedOptionId !== id}
            disabled={disabled}
            onSelect={() => onSelectOption(id)}
          />
        ))}

        {question.allowOther && (
          <OtherCard
            isSelected={isOtherSelected}
            isDimmed={hasSelection && !isOtherSelected}
            otherText={otherText}
            disabled={disabled}
            onChange={onChangeOther}
          />
        )}
      </motion.div>
    </fieldset>
  );
}

/**
 * The distinct free-text affordance: a dashed card with an inline input. When the
 * PM types into it, it carries the SAME full selected treatment as an option card
 * (accent border, tint, shadow, a filled check) and the other cards recede - so
 * the custom answer clearly becomes the selection (Item 8); when an option card
 * is selected instead, this card recedes/dims like the others. Selection is
 * mutually exclusive in the parent's draft state.
 */
function OtherCard({
  isSelected,
  isDimmed,
  otherText,
  disabled,
  onChange,
}: {
  isSelected: boolean;
  isDimmed: boolean;
  otherText: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <motion.div
      layout
      variants={{
        hidden: { opacity: 0, y: 18, scale: 0.98 },
        show: { opacity: 1, y: 0, scale: 1, transition: SPRING_SOFT },
      }}
      animate={{
        opacity: isDimmed ? 0.45 : 1,
        scale: isSelected ? 1.03 : isDimmed ? 0.97 : 1,
        filter: isDimmed ? "saturate(0.6)" : "saturate(1)",
      }}
      transition={SPRING_SOFT}
      className={
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed p-5 transition-colors " +
        (isSelected
          ? "border-accent bg-accent/[0.08] shadow-[0_18px_50px_-20px_rgba(255,117,31,0.55)]"
          : "border-line-2 bg-surface/40")
      }
    >
      <div
        className={
          "flex items-center gap-2 transition-colors " +
          (isSelected ? "text-ink" : "text-muted")
        }
      >
        {/* Selection dot mirrors the option cards: fills with the accent + check
            when the custom answer is the active selection (Item 8). */}
        <span
          className={
            "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors " +
            (isSelected ? "border-accent bg-accent text-canvas" : "border-line-2 text-transparent")
          }
          aria-hidden
        >
          <motion.span
            initial={false}
            animate={{ scale: isSelected ? 1 : 0 }}
            transition={SPRING}
          >
            <Check size={12} strokeWidth={3} />
          </motion.span>
        </span>
        <PenLine size={16} aria-hidden />
        <span className="text-[0.95rem] font-medium">Something else</span>
      </div>
      <input
        type="text"
        className={
          "w-full rounded-xl border bg-canvas-2 px-3.5 py-2.5 text-[0.95rem] text-ink " +
          "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
          (isSelected ? "border-accent/60" : "border-line")
        }
        placeholder="Describe your own answer…"
        value={otherText}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </motion.div>
  );
}
