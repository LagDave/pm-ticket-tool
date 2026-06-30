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
    <div className="flex flex-col gap-1">
      <h3 className="eyebrow mt-4">User story</h3>
      <p className="m-0 font-display text-lg leading-snug text-ink">{ticket.user_story}</p>

      {hasText(details?.problemBackground) && (
        <>
          <h3 className="eyebrow mt-4">Problem / Background</h3>
          <p className="m-0 text-sm text-muted leading-relaxed">{details!.problemBackground}</p>
        </>
      )}

      <h3 className="eyebrow mt-4">Acceptance criteria</h3>
      <ol className="list-none m-0 p-0 flex flex-col gap-2">
        {(ticket.acceptance_criteria ?? []).map((criterion, index) => (
          <li key={index} className="surface-2 flex flex-col gap-0.5 px-3.5 py-2.5 text-sm text-ink">
            <span><strong className="text-accent font-semibold mr-1.5">Given</strong> {criterion.given}</span>
            <span><strong className="text-accent font-semibold mr-1.5">When</strong> {criterion.when}</span>
            <span><strong className="text-accent font-semibold mr-1.5">Then</strong> {criterion.then}</span>
          </li>
        ))}
      </ol>

      {details?.keyDecisions?.length ? (
        <>
          <h3 className="eyebrow mt-4">Key decisions</h3>
          <ul className="m-0 pl-4 flex flex-col gap-1.5 text-sm text-ink leading-snug">
            {details.keyDecisions.map((kd, index) => (
              <li key={index}>
                <strong className="text-accent font-semibold">{kd.label}</strong>
                {hasText(kd.detail) ? `: ${kd.detail}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.openQuestions?.length ? (
        <>
          <h3 className="eyebrow mt-4">Open questions</h3>
          <ul className="m-0 pl-4 flex flex-col gap-1.5 text-sm text-ink leading-snug">
            {details.openQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.successMetrics?.length ? (
        <>
          <h3 className="eyebrow mt-4">Success metrics</h3>
          <ul className="m-0 pl-4 flex flex-col gap-1.5 text-sm text-ink leading-snug">
            {details.successMetrics.map((metric, index) => (
              <li key={index}>{metric}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.dependencies?.length ? (
        <>
          <h3 className="eyebrow mt-4">Dependencies</h3>
          <ul className="m-0 pl-4 flex flex-col gap-1.5 text-sm text-ink leading-snug">
            {details.dependencies.map((dependency, index) => (
              <li key={index}>{dependency}</li>
            ))}
          </ul>
        </>
      ) : null}

      {details?.codebaseGrounding?.length ? (
        <>
          <h3 className="eyebrow mt-4">Codebase grounding</h3>
          <ul className="m-0 pl-4 flex flex-col gap-1.5 text-sm text-ink leading-snug">
            {details.codebaseGrounding.map((item, index) => (
              <li key={index}>
                <code className="font-mono text-xs px-1.5 py-0.5 rounded border border-line bg-canvas-2 text-ink">{item.area}</code>: {item.note}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="eyebrow mt-4">Effort</h3>
      <p className="m-0 flex items-baseline gap-3">
        <strong className="font-display text-xl text-accent">{ticket.effort}</strong>
        <span className="text-xs text-faint">{EFFORT_NOTE}</span>
      </p>

      {ticket.priority && (
        <>
          <h3 className="eyebrow mt-4">Priority</h3>
          <p className="m-0 flex items-baseline gap-3">
            <strong className="font-display text-xl text-accent">{priorityLabel(ticket.priority)}</strong>
            <span className="text-xs text-faint">{PRIORITY_NOTE}</span>
          </p>
        </>
      )}

      {hasText(ticket.context_summary) && (
        <>
          <h3 className="eyebrow mt-4">Context</h3>
          <p className="m-0 text-sm text-muted leading-relaxed">{ticket.context_summary}</p>
        </>
      )}
    </div>
  );
}
