/**
 * Pure helpers for the ordered build-speed scale (spec 6, §12.2 utils). The
 * backend's OptionSpeed is an ordered 5-step scale slowest→fastest where
 * `fastest` = least build effort. The deck-of-cards UI renders it as a 5-segment
 * meter and can weight the deck by it, so the ordering lives here once, typed,
 * no `any` (§17.2). Framework-free.
 */
import type { OptionSpeed } from "../types/interview";

/** The scale in order, slowest→fastest. The index into this array is the rank. */
export const SPEED_ORDER: readonly OptionSpeed[] = [
  "slowest",
  "slow",
  "moderate",
  "fast",
  "fastest",
];

/** Total segments in the meter - the length of the scale. Named, not magic. */
export const SPEED_SEGMENTS = SPEED_ORDER.length;

/** Short human labels for each step (the meter caption). */
const SPEED_LABEL: Record<OptionSpeed, string> = {
  slowest: "Slowest",
  slow: "Slow",
  moderate: "Moderate",
  fast: "Fast",
  fastest: "Fastest",
};

/** A one-line plain explanation of the tradeoff each step represents. */
const SPEED_HINT: Record<OptionSpeed, string> = {
  slowest: "Most build effort",
  slow: "More build effort",
  moderate: "Balanced effort",
  fast: "Less build effort",
  fastest: "Least build effort",
};

/** 0-based rank on the scale (0 = slowest, 4 = fastest). */
export function speedRank(speed: OptionSpeed): number {
  const index = SPEED_ORDER.indexOf(speed);
  return index === -1 ? 0 : index;
}

/** How many of the 5 meter segments are filled for a speed (1-based: 1..5). */
export function speedFilledSegments(speed: OptionSpeed): number {
  return speedRank(speed) + 1;
}

/** The short label for the meter. */
export function speedLabel(speed: OptionSpeed): string {
  return SPEED_LABEL[speed];
}

/** The plain-language tradeoff hint. */
export function speedHint(speed: OptionSpeed): string {
  return SPEED_HINT[speed];
}
