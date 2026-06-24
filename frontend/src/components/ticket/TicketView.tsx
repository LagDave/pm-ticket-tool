/**
 * TicketView - the ticket feature's main view (spec T4/What, §12.3). Renders the
 * full ticket via the shared TicketReadView (story, problem, criteria, the
 * enrichment sections, effort + priority, context). Toggles inline edit, hosts the
 * comments panel and the copy actions (short-with-link + full Markdown), and offers
 * finalize. Server state comes from the useTicket hook (§14.3, §15.1); only the
 * edit-mode toggle is local UI state. No fetch, no business logic here (§14.1);
 * errors surface via toast in the hooks (§16.3). Typed, no any (§17.2).
 */
import { useState } from "react";
import { useFinalizeTicket, useTicket } from "../../hooks/queries/useTicketQueries";
import { CopyTicketButton } from "./CopyTicketButton";
import { TicketComments } from "./TicketComments";
import { TicketEditFields } from "./TicketEditFields";
import { TicketReadView } from "./TicketReadView";

interface TicketViewProps {
  ticketId: number;
}

export function TicketView({ ticketId }: TicketViewProps) {
  const { data, isLoading, error } = useTicket(ticketId);
  const finalize = useFinalizeTicket(ticketId);
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading) return <p className="field-hint">Loading ticket…</p>;
  if (error || !data) {
    return <p className="field-hint">Could not load the ticket. Try again.</p>;
  }

  const { ticket, comments } = data;
  const isFinal = ticket.status === "final";

  return (
    <section className="step-panel ticket-view">
      <header className="ticket-header">
        <h2 className="step-heading">Ticket</h2>
        <span className={`ticket-status ticket-status-${ticket.status}`}>
          {ticket.status} · v{ticket.version}
        </span>
      </header>

      {isEditing ? (
        <TicketEditFields ticket={ticket} onDone={() => setIsEditing(false)} />
      ) : (
        <TicketReadView ticket={ticket} />
      )}

      {!isEditing && (
        <div className="step-actions">
          {!isFinal && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
          <CopyTicketButton ticket={ticket} />
          {!isFinal && (
            <button
              type="button"
              className="primary-button"
              onClick={() => finalize.mutate(ticket.version)}
              disabled={finalize.isPending}
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
        </div>
      )}

      <TicketComments ticketId={ticket.id} comments={comments} />
    </section>
  );
}
