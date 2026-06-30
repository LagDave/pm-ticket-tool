/**
 * TicketView - the ticket feature's main view (spec T4/What, §12.3). Renders the
 * full ticket via the shared TicketReadView (story, problem, criteria, the
 * enrichment sections, effort + priority, context). Toggles inline edit, hosts the
 * comments panel and the copy actions (short-with-link + full Markdown), and offers
 * finalize. Once finalized, a session attached to a project also offers "Merge to
 * project context" (spec T13 — merge-on-complete): it proposes candidate bits from
 * the ticket, then reuses the resolve screen so the PM disposes them (stamped
 * "merged"). Server state comes from the useTicket / useSession hooks (§14.3,
 * §15.1); only the edit toggle + the proposed plan are local UI state. No fetch, no
 * business logic here (§14.1); errors surface via toast in the hooks (§16.3). Typed,
 * no any (§17.2).
 */
import { useState } from "react";
import { ReconcileResolve } from "../bits/ReconcileResolve";
import { useProposeBits } from "../../hooks/queries/useProjectQueries";
import { useSession } from "../../hooks/queries/useInterviewSessionQueries";
import { useFinalizeTicket, useTicket } from "../../hooks/queries/useTicketQueries";
import type { MergeProposal } from "../../types/project";
import { CopyTicketButton } from "./CopyTicketButton";
import { TicketComments } from "./TicketComments";
import { TicketEditFields } from "./TicketEditFields";
import { TicketReadView } from "./TicketReadView";

interface TicketViewProps {
  ticketId: number;
}

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

  if (isLoading) return <p className="text-sm text-muted">Loading ticket…</p>;
  if (error || !data) {
    return <p className="text-sm text-muted">Could not load the ticket. Try again.</p>;
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
    <section className="surface rounded-card p-6">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xl text-ink m-0">Ticket</h2>
        <span className={isFinal ? "pill pill-success" : "pill"}>
          {ticket.status} · v{ticket.version}
        </span>
      </header>

      {isEditing ? (
        <TicketEditFields ticket={ticket} onDone={() => setIsEditing(false)} />
      ) : (
        <TicketReadView ticket={ticket} />
      )}

      {!isEditing && (
        <div className="flex flex-wrap items-center gap-2 mt-5">
          {!isFinal && (
            <button
              type="button"
              className="btn"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
          <CopyTicketButton ticket={ticket} />
          {!isFinal && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => finalize.mutate(ticket.version)}
              disabled={finalize.isPending}
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {canMerge && (
            <button
              type="button"
              className="btn"
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
