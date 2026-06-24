/**
 * CopyTicketButton — copies the ticket's canonical Markdown to the clipboard
 * (spec T4/T5, §12.3). The string it copies is exactly tickets.rendered_markdown
 * from the API, so the copy matches what the backend rendered. A component
 * renders + delegates; errors surface via the shared toast (§16.3), never a
 * swallowed catch (§16.2).
 */
import { useState } from "react";
import { toast } from "../../lib/toast";

interface CopyTicketButtonProps {
  /** The canonical rendered Markdown (tickets.rendered_markdown). */
  markdown: string | null;
}

/** How long the "Copied" confirmation stays before reverting. Named, not magic. */
const COPIED_RESET_MS = 1_500;

export function CopyTicketButton({ markdown }: CopyTicketButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => void handleCopy()}
      disabled={!markdown}
    >
      {copied ? "Copied!" : "Copy as Markdown"}
    </button>
  );
}
