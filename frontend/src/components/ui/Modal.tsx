/**
 * Modal - a centered popup over a dim, blurred backdrop (§13.2). Presentational
 * only: it renders its children inside the shared `.bit-overlay` scaffold (the
 * same one the prompt/import dialogs use) and owns no business logic (§14.1). The
 * page behind stays mounted but is overlaid + blurred so the PM focuses on one
 * task. Closes on the backdrop click and the Escape key; the close affordance is
 * disabled while `busy` so a submit in flight can't be interrupted. Rendered via
 * a portal to document.body so the fixed overlay fills the whole viewport instead
 * of being trapped by a transformed ancestor (the page shell animates with a
 * lingering transform, which would otherwise become the fixed containing block).
 * Typed, no any (§17.2).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  /** Heading shown in the popup's header. */
  title: string;
  /** Optional one-line hint under the heading. */
  hint?: string;
  /** True while a submit is in flight — disables the close affordances. */
  busy?: boolean;
  /** Close the popup (backdrop click, Escape, or the Close button). */
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ title, hint, busy = false, onClose, children }: ModalProps) {
  // Escape closes the popup unless a submit is in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        // Close only when the backdrop itself is pressed, not the card.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="surface my-auto w-full max-w-xl p-5">
        <header className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        {hint && <p className="mb-4 text-sm text-muted">{hint}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
