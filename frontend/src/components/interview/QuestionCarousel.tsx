/**
 * QuestionCarousel - shows one question of the open batch at a time as a swipeable
 * pager (Change 1 / spec UX). Replaces the old vertical stack of every question's
 * deck: the PM answers each question on its own screen and moves freely between
 * them. Navigation is three ways - drag/swipe left-right (Framer Motion `drag`),
 * neutral prev/next arrows (disabled at the ends), and a clickable dot rail (one
 * dot per question; the active dot carries the orange accent, answered questions
 * read as a brighter-neutral dot). Each screen is the question text + its full
 * OptionDeck (the card stagger within a question is the deck's own motion).
 *
 * Presentational + UI motion only. The only local state is the carousel position
 * and slide direction; the draft answers, the mutations, and the server state all
 * stay in QuestionBatch / the hooks (§13.3, §14.1, §15.1). Typed, no `any` (§17.2).
 *
 * Restraint (§ accent policy): every pager control is neutral on the dark canvas;
 * the orange is spent only on the single active dot, never the arrows or the
 * inactive/answered dots.
 */
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { SPRING_SOFT, slideVariants } from "../../lib/motion";
import type { InterviewQuestion } from "../../types/interview";
import { OptionDeck } from "./OptionDeck";

interface QuestionCarouselProps {
  questions: InterviewQuestion[];
  /** Current selection per question id (option id, OTHER sentinel, or null). */
  selectedByQuestion: Record<string, string | null>;
  /** Free-text per question id. */
  otherByQuestion: Record<string, string>;
  /** True when the question at this id has a usable answer (drives the dot state). */
  isAnswered: (questionId: string) => boolean;
  disabled: boolean;
  onSelectOption: (questionId: string, optionId: string) => void;
  /** Make the custom free-text the active selection for a question (on focus). */
  onSelectOther: (questionId: string) => void;
  onChangeOther: (questionId: string, otherText: string) => void;
  /** True when every question is answered (enables the last-slide submit check). */
  canSubmit: boolean;
  /** Submit the batch; the check button on the last question triggers this. */
  onSubmit: () => void;
}

/** Drag distance (px) past which a swipe commits to the next/prev question. */
const SWIPE_COMMIT_PX = 60;

export function QuestionCarousel({
  questions,
  selectedByQuestion,
  otherByQuestion,
  isAnswered,
  disabled,
  canSubmit,
  onSelectOption,
  onSelectOther,
  onChangeOther,
  onSubmit,
}: QuestionCarouselProps) {
  // [index, direction] - direction (+1/-1) tells the slide which way to animate.
  const [position, setPosition] = useState<{ index: number; direction: number }>({
    index: 0,
    direction: 0,
  });
  const total = questions.length;

  // If a new batch arrives with fewer questions, keep the index in range.
  useEffect(() => {
    setPosition((prev) =>
      prev.index < total ? prev : { index: Math.max(total - 1, 0), direction: 0 },
    );
  }, [total]);

  const index = Math.min(position.index, Math.max(total - 1, 0));
  const goTo = (next: number): void => {
    if (next < 0 || next >= total || next === index) return;
    setPosition({ index: next, direction: next > index ? 1 : -1 });
  };

  const handleDragEnd = (_: unknown, info: PanInfo): void => {
    if (info.offset.x <= -SWIPE_COMMIT_PX) goTo(index + 1);
    else if (info.offset.x >= SWIPE_COMMIT_PX) goTo(index - 1);
  };

  const current = questions[index];
  if (!current) return null;

  return (
    <div>
      <p className="carousel-position">
        Question {index + 1} of {total}
      </p>

      {/* Drag lives on this STABLE wrapper (not the presence-keyed slide):
          putting `drag` on the keyed child wedges AnimatePresence `mode="wait"`,
          so the slide would never swap. The keyed child only slides. */}
      <motion.div
        className={
          "carousel-stage" + (total > 1 ? " cursor-grab active:cursor-grabbing" : "")
        }
        drag={total > 1 ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
      >
        <AnimatePresence mode="wait" custom={position.direction} initial={false}>
          <motion.div
            key={current.id}
            custom={position.direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <OptionDeck
              question={current}
              selectedOptionId={selectedByQuestion[current.id] ?? null}
              otherText={otherByQuestion[current.id] ?? ""}
              disabled={disabled}
              onSelectOption={(optionId) => onSelectOption(current.id, optionId)}
              onSelectOther={() => onSelectOther(current.id)}
              onChangeOther={(otherText) => onChangeOther(current.id, otherText)}
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <CarouselPager
        index={index}
        questions={questions}
        isAnswered={isAnswered}
        canSubmit={canSubmit}
        onJump={goTo}
        onSubmit={onSubmit}
      />
    </div>
  );
}

/** The pager row: prev arrow · dot rail · next arrow. Neutral; presentational. */
function CarouselPager({
  index,
  questions,
  isAnswered,
  canSubmit,
  onJump,
  onSubmit,
}: {
  index: number;
  questions: InterviewQuestion[];
  isAnswered: (questionId: string) => boolean;
  canSubmit: boolean;
  onJump: (next: number) => void;
  onSubmit: () => void;
}) {
  const total = questions.length;

  return (
    <div className="carousel-pager">
      <button
        type="button"
        className="carousel-arrow"
        onClick={() => onJump(index - 1)}
        disabled={index === 0}
        aria-label="Previous question"
      >
        <ChevronLeft size={18} aria-hidden />
      </button>

      <div className="carousel-dots" role="tablist" aria-label="Questions in this batch">
        {questions.map((question, i) => (
          <motion.button
            key={question.id}
            type="button"
            layout
            transition={SPRING_SOFT}
            className={
              "carousel-dot" +
              (i === index ? " is-active" : "") +
              (i !== index && isAnswered(question.id) ? " is-answered" : "")
            }
            onClick={() => onJump(i)}
            role="tab"
            aria-selected={i === index}
            aria-label={
              `Question ${i + 1}` + (isAnswered(question.id) ? " (answered)" : "")
            }
          />
        ))}
      </div>

      {index === total - 1 ? (
        <button
          type="button"
          className="carousel-arrow is-submit"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Submit answers"
          title="Submit answers"
        >
          <Check size={18} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="carousel-arrow"
          onClick={() => onJump(index + 1)}
          aria-label="Next question"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
