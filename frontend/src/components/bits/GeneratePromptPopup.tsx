/**
 * GeneratePromptPopup - shows the server-owned "generate bits" prompt for a
 * project so the PM can paste it into a separate Claude Code session run against
 * the app's repo, then upload the JSON it writes back (spec T10/T11). A modal
 * overlay; a component renders + delegates (§13.2): it fetches via the
 * enabled-gated useBitPrompt hook (§15.1) — no fetch or business logic here
 * (§14.1) — and surfaces failures through the hook's error state + the clipboard
 * copy via toast (§16.3). Typed, no any (§17.2).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useBitPrompt } from "../../hooks/queries/useProjectQueries";
import { toast } from "../../lib/toast";

interface GeneratePromptPopupProps {
  projectId: number;
  /** Close the popup and return to the bits list. */
  onClose: () => void;
}

export function GeneratePromptPopup({ projectId, onClose }: GeneratePromptPopupProps) {
  // Mounted only while open, so `enabled` is always true — the gate exists so the
  // hook never fetches when this component isn't rendered.
  const { data, isLoading, error } = useBitPrompt(projectId, true);
  const [didCopy, setDidCopy] = useState(false);

  const handleCopy = (): void => {
    const prompt = data?.prompt;
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(
      () => {
        setDidCopy(true);
        window.setTimeout(() => setDidCopy(false), 2000);
      },
      () => {
        toast.error("Could not copy to the clipboard. Select the text and copy it manually.");
      },
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Generate bits prompt"
    >
      <div className="surface my-auto w-full max-w-2xl p-5">
        <header className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">
            Generate bits from your repo
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="mb-4 text-sm text-muted">
          Paste this into a Claude Code session on your repo, then upload the JSON
          it writes with “Import bits”.
        </p>

        {isLoading && <p className="text-sm text-muted">Loading the prompt…</p>}
        {error && (
          <p className="text-sm text-muted">Could not load the prompt. Close this and try again.</p>
        )}

        {data && (
          <>
            <pre className="surface-2 max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-ink">
              {data.prompt}
            </pre>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={handleCopy}>
                {didCopy ? "Copied" : "Copy prompt"}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
