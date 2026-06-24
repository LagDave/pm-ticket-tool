/**
 * TicketReadView - the read-only rendering of a ticket's content (spec What/T9).
 * Pure presentational (§13.3): the story, problem/background, criteria, the
 * enrichment sections (key decisions, open questions, success metrics,
 * dependencies, codebase grounding), and the effort + priority tiers with their
 * "verify/confirm" notes. Empty sections are omitted. Shared by TicketView (owner)
 * and SharedTicketView (public) so there is one renderer, not two (§4.3) - both
 * pass the same content shape.
 */
import type {
  AcceptanceCriterion,
  EffortTier,
  TicketDetails,
  TicketPriority,
} from "../../types/ticket";

/** The content fields this renders - the common subset of Ticket and PublicTicket. */
export interface ReadableTicket {
  user_story: string | null;
  acceptance_criteria: AcceptanceCriterion[] | null;
  effort: EffortTier | null;
  priority: TicketPriority | null;
  context_summary: string | null;
  details: TicketDetails | null;
}

/** Fixed notes that keep the tiers honest (spec Risk: tier overconfidence). */
const EFFORT_NOTE = "Complexity tier, verify with engineering, not an hour estimate.";
const PRIORITY_NOTE = "Impact tier, confirm with the team.";

/** Title-case a priority tier for display (high -> High). */
function priorityLabel(priority: TicketPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** True when a value is a non-empty, non-blank string. */
function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function TicketReadView({ ticket }: { ticket: ReadableTicket }) {
  const details = ticket.details;
  return (
    <div className="ticket-read">
      <h3 className="ticket-section-heading">User story</h3>
      <p className="ticket-story">{ticket.user_story}</p>

      {hasText(details?.problemBackground) && (
        <>
          <h3 className="ticket-section-heading">Problem / Background</h3>
          <p className="ticket-prose">{details!.problemBackground}</p>
        </>
      )}

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

      {details?.keyDecisions?.length ? (
        <>
          <h3 className="ticket-section-heading">Key decisions</h3>
          <ul className="ticket-bullets">
            {details.keyDecisions.map((kd, index) => (
              <li key={index}>
                <strong>{kd.label}</strong>
                {hasText(kd.detail) ? `: ${kd.detail}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.openQuestions?.length ? (
        <>
          <h3 className="ticket-section-heading">Open questions</h3>
          <ul className="ticket-bullets">
            {details.openQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.successMetrics?.length ? (
        <>
          <h3 className="ticket-section-heading">Success metrics</h3>
          <ul className="ticket-bullets">
            {details.successMetrics.map((metric, index) => (
              <li key={index}>{metric}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.dependencies?.length ? (
        <>
          <h3 className="ticket-section-heading">Dependencies</h3>
          <ul className="ticket-bullets">
            {details.dependencies.map((dependency, index) => (
              <li key={index}>{dependency}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.codebaseGrounding?.length ? (
        <>
          <h3 className="ticket-section-heading">Codebase grounding</h3>
          <ul className="ticket-bullets ticket-grounding">
            {details.codebaseGrounding.map((item, index) => (
              <li key={index}><code>{item.area}</code>: {item.note}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="ticket-section-heading">Effort</h3>
      <p className="ticket-effort">
        <strong>{ticket.effort}</strong>
        <span className="effort-note">{EFFORT_NOTE}</span>
      </p>

      {ticket.priority && (
        <>
          <h3 className="ticket-section-heading">Priority</h3>
          <p className="ticket-effort">
            <strong>{priorityLabel(ticket.priority)}</strong>
            <span className="effort-note">{PRIORITY_NOTE}</span>
          </p>
        </>
      )}

      {hasText(ticket.context_summary) && (
        <>
          <h3 className="ticket-section-heading">Context</h3>
          <p className="ticket-context">{ticket.context_summary}</p>
        </>
      )}
    </div>
  );
}
