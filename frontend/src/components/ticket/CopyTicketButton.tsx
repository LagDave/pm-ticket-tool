/**
 * CopyTicketButton - the ticket copy actions (spec What/T4, §12.3). Two copies:
 * the SHORT artifact (core fields + a "View full ticket" link, built client-side
 * from the share token) as the primary action a PM pastes elsewhere, and the full
 * canonical Markdown (tickets.rendered_markdown) as a secondary. A component
 * renders + delegates; errors surface via the shared toast (§16.3), never a
 * swallowed catch (§16.2). Typed, no any (§17.2).
 */
import { useState } from "react";
import { buildShortTicketMarkdown } from "../../lib/shortTicketMarkdown";
import { toast } from "../../lib/toast";
import type { Ticket } from "../../types/ticket";

interface CopyTicketButtonProps {
  ticket: Ticket;
}

/** How long the "Copied" confirmation stays before reverting. Named, not magic. */
const COPIED_RESET_MS = 1_500;

type CopyKind = "short" | "full";

export function CopyTicketButton({ ticket }: CopyTicketButtonProps) {
  const [copied, setCopied] = useState<CopyKind | null>(null);

  const copy = async (kind: CopyKind, text: string | null): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(
        () => setCopied((current) => (current === kind ? null : current)),
        COPIED_RESET_MS,
      );
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  return (
    <>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void copy("short", buildShortTicketMarkdown(ticket))}
      >
        {copied === "short" ? "Copied!" : "Copy ticket + link"}
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void copy("full", ticket.rendered_markdown)}
        disabled={!ticket.rendered_markdown}
      >
        {copied === "full" ? "Copied!" : "Copy full Markdown"}
      </button>
    </>
  );
}
