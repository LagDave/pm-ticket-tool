/**
 * TicketStep - the wizard's terminal step (spec T4): after the interview
 * completes, generate the durable ticket from the session, then hand off to
 * TicketView for review/edit/comment/finalize/copy. Generation runs through the
 * useGenerateTicket hook (§14.3); the generated ticket id is the only local UI
 * state. No fetch, no business logic here (§14.1); errors surface via toast
 * (§16.3). Mirrors the QuestionBatch generate-then-render shape (§12.3).
 */
import { useState } from "react";
import { ThinkingLoader } from "../ui/ThinkingLoader";
import { useGenerateTicket } from "../../hooks/queries/useTicketQueries";
import { TicketView } from "./TicketView";

interface TicketStepProps {
  sessionId: number;
}

export function TicketStep({ sessionId }: TicketStepProps) {
  const generate = useGenerateTicket(sessionId);
  const [ticketId, setTicketId] = useState<number | null>(null);

  const handleGenerate = (): void => {
    generate.mutate(undefined, { onSuccess: (ticket) => setTicketId(ticket.id) });
  };

  if (ticketId !== null) {
    return <TicketView ticketId={ticketId} />;
  }

  // While the ticket generates, show the shared rotating loader instead of a
  // "Generating…" button label (Rev 2), matching every other wait in the app.
  if (generate.isPending) {
    return (
      <section className="step-panel">
        <h2 className="step-heading">Draft the ticket</h2>
        <ThinkingLoader subtitle="Drafting your ticket" />
      </section>
    );
  }

  return (
    <section className="step-panel">
      <h2 className="step-heading">Draft the ticket</h2>
      <p className="field-hint">
        We have enough decisions to draft a ticket: a user story, Given/When/Then
        acceptance criteria, an effort tier, and a short context summary.
      </p>
      <div className="step-actions">
        <button
          type="button"
          className="primary-button"
          onClick={handleGenerate}
        >
          Generate ticket
        </button>
      </div>
    </section>
  );
}
