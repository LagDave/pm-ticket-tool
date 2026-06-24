/**
 * Button — the one styled button primitive for the dark UI (§12.3, §13.3).
 * Three intents (primary = amber accent, secondary = outline, ghost = quiet link)
 * with a subtle Framer Motion press/hover. Reused app-wide so actions look
 * consistent; presentational only, no fetch or business logic.
 */
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { SPRING } from "../../lib/motion";

type ButtonIntent = "primary" | "secondary" | "ghost";

interface ButtonProps {
  children: ReactNode;
  intent?: ButtonIntent;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  /** Optional leading icon (e.g. a lucide-react glyph). */
  icon?: ReactNode;
  className?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium text-[0.95rem] " +
  "px-5 py-2.5 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
  "select-none";

const INTENT: Record<ButtonIntent, string> = {
  primary:
    "bg-accent text-canvas font-semibold shadow-[0_8px_24px_-8px_rgba(255,178,36,0.6)] " +
    "hover:bg-accent-soft",
  secondary:
    "border border-line-2 bg-surface/60 text-ink hover:border-accent/60 hover:bg-surface-2",
  ghost: "text-muted hover:text-ink",
};

export function Button({
  children,
  intent = "primary",
  type = "button",
  disabled = false,
  onClick,
  icon,
  className = "",
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
      className={`${BASE} ${INTENT[intent]} ${className}`}
    >
      {icon}
      {children}
    </motion.button>
  );
}
