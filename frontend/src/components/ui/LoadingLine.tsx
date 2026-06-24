/**
 * LoadingLine - a small inline loading indicator: a spinning ring plus a label
 * (§12.3, §13.3). Replaces bare "Loading…" text that had no animated indicator,
 * so a load/resume reads as actively in progress. Presentational + motion only;
 * no fetch, no business logic (§14.1). Typed, no `any` (§17.2).
 */
import { motion } from "framer-motion";

interface LoadingLineProps {
  /** The label beside the spinner (e.g. "Loading feature scope…"). */
  label: string;
}

export function LoadingLine({ label }: LoadingLineProps) {
  return (
    <div className="loading-line" role="status" aria-live="polite">
      <motion.span
        className="loading-line-spinner"
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
      />
      <span className="loading-line-label">{label}</span>
    </div>
  );
}
