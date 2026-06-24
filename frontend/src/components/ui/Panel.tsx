/**
 * Panel — the surface card primitive for the dark UI (§12.3, §13.3). A bordered,
 * faintly-lit surface that animates in as a wizard step or section. Wraps content
 * with consistent padding/edge treatment so every screen matches; presentational.
 */
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { stepIn } from "../../lib/motion";

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className = "" }: PanelProps) {
  return (
    <motion.section
      variants={stepIn}
      initial="hidden"
      animate="show"
      className={
        "relative overflow-hidden rounded-[var(--radius-card)] border border-line " +
        "bg-surface/70 p-7 backdrop-blur-sm " +
        "shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)] " +
        className
      }
    >
      {/* A hairline top highlight so the card edge catches the atmosphere light. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line-2 to-transparent"
      />
      {children}
    </motion.section>
  );
}
