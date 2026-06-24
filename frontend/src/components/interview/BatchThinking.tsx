/**
 * BatchThinking — the labeled, animated "figuring out the questions" indicator
 * shown while a batch generates (spec 2 UX). It replaces a bare "Generating…":
 * an animated dual-ring orb plus a primary label that rotates through a few
 * phases ("Reading your answers…" → "Grounding in your request…" → "Drafting
 * the next questions…") so the wait feels intentional and clearly in progress.
 * Presentational + motion only; no fetch, no business logic (§14.1). Typed,
 * no `any` (§17.2).
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

interface BatchThinkingProps {
  /** The batch number being generated, shown in the sub-line for orientation. */
  batchNumber: number;
}

/** The rotating phase labels. Named, not magic (§4.2). */
const PHASES: readonly string[] = [
  "Figuring out the right questions…",
  "Reading your answers so far…",
  "Grounding in your request…",
  "Drafting the next questions…",
];

/** How long each phase shows before rotating, in ms. Named, not magic. */
const PHASE_MS = 1_800;

export function BatchThinking({ batchNumber }: BatchThinkingProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase((current) => (current + 1) % PHASES.length);
    }, PHASE_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <motion.div
      className="batch-loading"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      role="status"
      aria-live="polite"
    >
      <span className="batch-loading-orb" aria-hidden />
      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            className="batch-loading-label"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {PHASES[phase]}
          </motion.div>
        </AnimatePresence>
        <div className="batch-loading-sub">Preparing batch {batchNumber}</div>
      </div>
    </motion.div>
  );
}
