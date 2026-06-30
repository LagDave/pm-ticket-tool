/**
 * Button - the one styled button primitive for the dark UI (§12.3, §13.3).
 * Three intents (primary = orange accent, secondary = neutral outline, ghost =
 * quiet link) with a subtle Framer Motion press/hover. Reused app-wide so actions
 * look consistent. Only `primary` carries the orange - secondary/ghost stay
 * neutral white on the dark canvas so the accent reads as a rare highlight.
 * Presentational only, no fetch or business logic.
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

// Render the shared DevEasy kit classes (defined in index.css, token-driven so
// light + dark both resolve). `select-none` is the only extra; motion is below.
const BASE = "btn select-none";

const INTENT: Record<ButtonIntent, string> = {
  primary: "btn-primary",
  secondary: "",
  ghost: "btn-ghost",
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
