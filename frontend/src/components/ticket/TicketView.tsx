/**
 * TicketView - the ticket feature's main view (spec T4, §12.3). Renders the
 * story, the Given/When/Then acceptance criteria, the effort tier (with the
 * fixed "verify with engineering" note, spec Risk), and the context. Toggles
 * inline edit, hosts the comments panel and the copy-to-clipboard button, and
 * offers finalize. Once finalized, a session attached to a project also offers
 * "Merge to project context" (spec T13 — merge-on-complete): it proposes
 * candidate bits from the ticket, then reuses the resolve screen so the PM
 * disposes them (stamped "merged"). Server state comes from the useTicket /
 * useSession hooks (§14.3, §15.1); only the edit toggle + the proposed plan are
 * local UI state. No fetch, no business logic here (§14.1); errors surface via
 * toast in the hooks (§16.3). Typed, no any (§17.2).
 */
import { useState } from "react";
import { ReconcileResolve } from "../bits/ReconcileResolve";
import { useProposeBits } from "../../hooks/queries/useProjectQueries";
import { useSession } from "../../hooks/queries/useInterviewSessionQueries";
import { useFinalizeTicket, useTicket } from "../../hooks/queries/useTicketQueries";
import type { MergeProposal } from "../../types/project";
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
  const sessionId = data?.ticket.session_id ?? null;
  // Read the parent session to learn its project attachment — the merge trigger
  // shows only for an attached session (spec T13). Disabled until the id is known.
  const { data: session } = useSession(sessionId);
  const propose = useProposeBits(sessionId);
  const finalize = useFinalizeTicket(ticketId);
  const [isEditing, setIsEditing] = useState(false);
  // The proposed candidates + plan to resolve; null until the PM clicks merge.
  const [proposal, setProposal] = useState<MergeProposal | null>(null);

  if (isLoading) return <p className="field-hint">Loading ticket…</p>;
  if (error || !data) {
    return <p className="field-hint">Could not load the ticket. Try again.</p>;
  }

  const { ticket, comments } = data;
  const isFinal = ticket.status === "final";
  const projectId = session?.project_id ?? null;
  // Merge-on-complete is offered once the ticket is final AND its session is
  // attached to a project (spec T13). The server re-checks both (§5.4).
  const canMerge = isFinal && projectId !== null;

  const handleMerge = (): void => {
    propose.mutate(undefined, { onSuccess: (result) => setProposal(result) });
  };

  // The resolve screen takes over so the PM focuses on disposing the proposal
  // (R2), reusing ReconcileResolve with merge provenance so applied bits are
  // stamped "merged" + the source ticket id (spec T13).
  if (proposal && projectId !== null) {
    return (
      <ReconcileResolve
        projectId={projectId}
        candidates={proposal.candidates}
        plan={proposal.plan}
        provenance={{ source: "merged", sourceTicketId: ticket.id }}
        onDone={() => setProposal(null)}
      />
    );
  }

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
          {canMerge && (
            <button
              type="button"
              className="secondary-button"
              onClick={handleMerge}
              disabled={propose.isPending}
            >
              {propose.isPending ? "Proposing…" : "Merge to project context"}
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
