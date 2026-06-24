/**
 * Shared Framer Motion variants + spring presets (§4.2 — named, not magic; reused
 * across the wizard so motion reads consistently). Physics-based springs, not
 * duration tweens, so reveals feel weighty rather than jittery. Pure data, no JSX.
 */
import type { Transition, Variants } from "framer-motion";

/** The house spring — a touch of bounce, settles fast. Used for entrances/lifts. */
export const SPRING: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 };

/** A softer spring for larger layout shifts (a card expanding forward). */
export const SPRING_SOFT: Transition = { type: "spring", stiffness: 260, damping: 30 };

/** Stagger step between sibling reveals, in seconds. Named, not magic. */
export const STAGGER_STEP = 0.07;

/** A container that staggers its children in on mount (the deck reveal). */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: STAGGER_STEP, delayChildren: 0.04 },
  },
};

/** A single item lifting up + fading in as part of a staggered reveal. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING },
};

/** A panel/screen fading + sliding in when a wizard step changes. */
export const stepIn: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18 } },
};

/** How far a carousel slide travels horizontally as it enters/leaves, in px. */
export const SLIDE_OFFSET = 56;

/**
 * Horizontal slide variants for a paged carousel (one question per screen). The
 * custom `direction` (+1 = moving to a later page, -1 = an earlier one) sets which
 * side a slide enters from and exits to, so forward/back read correctly. Pair with
 * AnimatePresence `mode="wait"` + `custom={direction}`.
 */
export const slideVariants: Variants = {
  enter: (direction: number) => ({
    x: direction >= 0 ? SLIDE_OFFSET : -SLIDE_OFFSET,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1, transition: SPRING_SOFT },
  exit: (direction: number) => ({
    x: direction >= 0 ? -SLIDE_OFFSET : SLIDE_OFFSET,
    opacity: 0,
    transition: { duration: 0.18 },
  }),
};
