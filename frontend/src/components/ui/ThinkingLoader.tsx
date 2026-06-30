/**
 * ThinkingLoader - the ONE loading indicator for the whole app (§12.3, §13.3).
 * An orange dual-ring orb, a serif title that swaps through a pool of mostly
 * "Dave" messages (loadingMessages.ts), and an optional muted subtitle for
 * context ("Preparing batch 2", "Loading your sessions"). When `done` is set it
 * swaps the orb for a green check and holds a single done line, so a step that
 * resolves (triage) finishes on a satisfying tick rather than snapping away.
 *
 * Replaces the three older loaders (batch orb, triage gauge, inline line) so the
 * app loads consistently everywhere (PM request). Presentational + motion only;
 * no fetch, no business logic (§14.1). One interval, cleared on unmount, so it is
 * StrictMode-safe; rendered without a wrapping mode="wait" presence (a prior bug
 * deadlocked the exit). Typed, no `any` (§17.2).
 */
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { shuffledMessages } from "../../lib/loadingMessages";

interface ThinkingLoaderProps {
  /** Optional muted context line under the rotating title (e.g. "Preparing batch 2"). */
  subtitle?: string;
  /** When true, stop rotating, swap the orb for a green check, and show `doneLabel`. */
  done?: boolean;
  /** The single line shown while `done` (e.g. "Got it. Routing you now…"). */
  doneLabel?: string;
}

/** How long each message shows before rotating, in ms. Named, not magic (§4.2). */
const PHASE_MS = 1_900;

export function ThinkingLoader({
  subtitle,
  done = false,
  doneLabel = "Done.",
}: ThinkingLoaderProps) {
  // A per-mount shuffled order so each wait starts on a different line (§4.2).
  const messages = useMemo(() => shuffledMessages(), []);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(() => {
      setPhase((current) => (current + 1) % messages.length);
    }, PHASE_MS);
    return () => window.clearInterval(timer);
  }, [done, messages.length]);

  const label = done ? doneLabel : messages[phase];

  return (
    <motion.div
      className="surface flex items-center gap-3.5 p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      role="status"
      aria-live="polite"
    >
      {done ? (
        <motion.span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border border-success/50 bg-success/15 text-success"
          aria-hidden
          initial={{ scale: 0, rotate: -25 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
        >
          <Check size={20} strokeWidth={3} />
        </motion.span>
      ) : (
        <span className="relative h-[26px] w-[26px] shrink-0" aria-hidden>
          {/* Dual-ring orb rebuilt with framer-motion (the old CSS pseudo-element
              rings lived in index.css, which this migration no longer relies on). */}
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
          />
          <motion.span
            className="absolute inset-[5px] rounded-full border-2 border-transparent border-t-accent-soft"
            animate={{ rotate: -360 }}
            transition={{ duration: 1.4, ease: "linear", repeat: Infinity }}
          />
        </span>
      )}
      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={done ? "done" : phase}
            className="font-display text-base font-medium text-ink"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {label}
          </motion.div>
        </AnimatePresence>
        {subtitle && <div className="mt-0.5 text-sm text-faint">{subtitle}</div>}
      </div>
    </motion.div>
  );
}
