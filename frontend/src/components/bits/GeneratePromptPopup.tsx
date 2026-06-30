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
    <div className="bit-overlay" role="dialog" aria-modal="true" aria-label="Generate bits prompt">
      <div className="bit-overlay-card is-modal">
        <header className="bit-overlay-head">
          <h2 className="step-heading">Generate bits from your repo</h2>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="field-hint">
          Paste this into a Claude Code session on your repo, then upload the JSON
          it writes with “Import bits”.
        </p>

        {isLoading && <p className="field-hint">Loading the prompt…</p>}
        {error && (
          <p className="field-hint">Could not load the prompt. Close this and try again.</p>
        )}

        {data && (
          <>
            <pre className="bit-prompt-block">{data.prompt}</pre>
            <div className="step-actions">
              <button type="button" className="primary-button" onClick={handleCopy}>
                {didCopy ? "Copied" : "Copy prompt"}
              </button>
              <button type="button" className="secondary-button" onClick={onClose}>
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
