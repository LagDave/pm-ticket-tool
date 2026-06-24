/**
 * OptionCard - one card in a question's animated deck (spec 6 centerpiece, §12.3,
 * §13.3). Shows the option label, the ordered build-speed meter, and - on the
 * single recommended pick - a ribbon badge + accent glow. Selecting it answers
 * the question: the chosen card lifts/expands forward while the rest recede/dim
 * (driven by the `isSelected`/`isDimmed` props the deck computes). Hover tilts
 * the card. Presentational + physics motion only; no fetch, no business logic.
 */
import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { SPRING, SPRING_SOFT, riseIn } from "../../lib/motion";
import type { QuestionOption } from "../../types/interview";
import { SpeedMeter } from "../ui/SpeedMeter";

interface OptionCardProps {
  option: QuestionOption;
  isSelected: boolean;
  /** True when another card in the deck is selected - this one recedes/dims. */
  isDimmed: boolean;
  disabled: boolean;
  onSelect: () => void;
}

export function OptionCard({
  option,
  isSelected,
  isDimmed,
  disabled,
  onSelect,
}: OptionCardProps) {
  const isRecommended = option.recommended;

  return (
    <motion.button
      type="button"
      layout
      variants={riseIn}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={isSelected}
      whileHover={disabled || isSelected ? undefined : { y: -6, rotate: -0.6, scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      animate={{
        opacity: isDimmed ? 0.45 : 1,
        scale: isDimmed ? 0.97 : 1,
        filter: isDimmed ? "saturate(0.6)" : "saturate(1)",
      }}
      transition={SPRING_SOFT}
      className={
        "group relative flex w-full min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border p-5 text-left " +
        "transition-colors cursor-pointer disabled:cursor-not-allowed " +
        (isSelected
          ? "z-10 border-accent bg-accent/[0.08] shadow-[0_12px_34px_-20px_rgba(255,117,31,0.5)]"
          : isRecommended
            ? "border-accent/55 bg-surface-2/80 shadow-[0_0_0_1px_rgba(255,117,31,0.12),0_20px_50px_-30px_rgba(255,117,31,0.4)]"
            : "border-line bg-surface/70 hover:border-line-2")
      }
    >
      {/* Recommended ribbon - top-right, accent. Only ever on one card per deck. */}
      {isRecommended && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-wide text-canvas">
          <Sparkles size={12} strokeWidth={2.5} aria-hidden />
          Recommended
        </span>
      )}

      <div className="flex items-start gap-3 pr-2">
        {/* Selection dot - fills with the accent + a check when chosen. */}
        <span
          className={
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors " +
            (isSelected
              ? "border-accent bg-accent text-canvas"
              : "border-line-2 text-transparent group-hover:border-accent/60")
          }
          aria-hidden
        >
          <motion.span
            initial={false}
            animate={{ scale: isSelected ? 1 : 0 }}
            transition={SPRING}
          >
            <Check size={14} strokeWidth={3} />
          </motion.span>
        </span>
        <span
          className={
            "text-[1.02rem] font-medium leading-snug " +
            (isRecommended && !isSelected ? "pr-24" : "")
          }
        >
          {option.label}
        </span>
      </div>

      <SpeedMeter speed={option.speed} muted={isDimmed} />
    </motion.button>
  );
}
