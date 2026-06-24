/**
 * TicketView - the ticket feature's main view (spec T4, §12.3). Renders the
 * story, the Given/When/Then acceptance criteria, the effort tier (with the
 * fixed "verify with engineering" note, spec Risk), and the context. Toggles
 * inline edit, hosts the comments panel and the copy-to-clipboard button, and
 * offers finalize. Server state comes from the useTicket hook (§14.3, §15.1);
 * only the edit-mode toggle is local UI state. No fetch, no business logic here
 * (§14.1); errors surface via toast in the hooks (§16.3). Typed, no any (§17.2).
 */
import { useState } from "react";
import { useFinalizeTicket, useTicket } from "../../hooks/queries/useTicketQueries";
import type { Ticket } from "../../types/ticket";
import { CopyTicketButton } from "./CopyTicketButton";
import { TicketComments } from "./TicketComments";
import { TicketEditFields } from "./TicketEditFields";

interface TicketViewProps {
  ticketId: number;
}

/** The fixed note that keeps the effort tier honest (spec Risk: effort overconfidence). */
const EFFORT_NOTE = "Complexity tier, verify with engineering, not an hour estimate.";

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
        <TicketReadView ticket={ticket} effortNote={EFFORT_NOTE} />
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
          <CopyTicketButton markdown={ticket.rendered_markdown} />
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

/** The read-only rendering of the ticket fields. Pure presentational child. */
function TicketReadView({
  ticket,
  effortNote,
}: {
  ticket: Ticket;
  effortNote: string;
}) {
  return (
    <div className="ticket-read">
      <h3 className="ticket-section-heading">User story</h3>
      <p className="ticket-story">{ticket.user_story}</p>

      <h3 className="ticket-section-heading">Acceptance criteria</h3>
      <ol className="criteria-list">
        {(ticket.acceptance_criteria ?? []).map((criterion, index) => (
          <li key={index} className="criterion-item">
            <span className="gwt"><strong>Given</strong> {criterion.given}</span>
            <span className="gwt"><strong>When</strong> {criterion.when}</span>
            <span className="gwt"><strong>Then</strong> {criterion.then}</span>
          </li>
        ))}
      </ol>

      <h3 className="ticket-section-heading">Effort</h3>
      <p className="ticket-effort">
        <strong>{ticket.effort}</strong>
        <span className="effort-note">{effortNote}</span>
      </p>

      <h3 className="ticket-section-heading">Context</h3>
      <p className="ticket-context">{ticket.context_summary}</p>
    </div>
  );
}
