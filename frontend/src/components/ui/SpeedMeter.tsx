/**
 * SpeedMeter — renders an OptionSpeed as an ordered 5-segment meter slowest→
 * fastest (spec 6, §12.3). Elegant, glanceable build-speed indicator for the
 * deck cards. The fill is deliberately NEUTRAL (off-white on the dark surface),
 * not the accent: the meter is purely informational, so it must not compete with
 * the orange that is reserved for the recommended badge, the primary action, and
 * the active/selected indicator. Filled segments are bright neutral, the rest
 * stay faint, with a short label + plain-language tradeoff hint. Presentational;
 * pure, typed (§17.2).
 */
import { motion } from "framer-motion";
import type { OptionSpeed } from "../../types/interview";
import {
  SPEED_SEGMENTS,
  speedFilledSegments,
  speedHint,
  speedLabel,
} from "../../utils/optionSpeed";

interface SpeedMeterProps {
  speed: OptionSpeed;
  /** Dim the accent (used on non-selected cards so the recommended one leads). */
  muted?: boolean;
}

export function SpeedMeter({ speed, muted = false }: SpeedMeterProps) {
  const filled = speedFilledSegments(speed);
  const segments = Array.from({ length: SPEED_SEGMENTS }, (_, i) => i < filled);
  // Neutral fill — NOT the accent (§ restraint): bright off-white when active,
  // dimmer when this card is recessed behind a selection.
  const fillClass = muted ? "bg-muted/40" : "bg-muted";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[0.7rem] font-medium uppercase tracking-wide text-faint">
        <span>Build speed</span>
        <span className="text-muted">{speedLabel(speed)}</span>
      </div>
      <div
        className="flex gap-1"
        role="meter"
        aria-valuemin={1}
        aria-valuemax={SPEED_SEGMENTS}
        aria-valuenow={filled}
        aria-label={`Build speed: ${speedLabel(speed)} — ${speedHint(speed)}`}
      >
        {segments.map((isFilled, i) => (
          <motion.span
            key={i}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 0.12 + i * 0.05, duration: 0.28 }}
            className={
              "h-1.5 flex-1 origin-left rounded-full " +
              (isFilled ? fillClass : "bg-line-2")
            }
          />
        ))}
      </div>
      <span className="text-[0.72rem] text-faint">{speedHint(speed)}</span>
    </div>
  );
}
