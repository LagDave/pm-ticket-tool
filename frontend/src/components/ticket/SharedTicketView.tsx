/**
 * SharedTicketView - the public, read-only view of a shared ticket (spec What).
 * Reached via the /?ticket=<token> deep link; fetches the public projection by
 * token through useSharedTicket (§14.3, §15.1) and renders it with the shared
 * TicketReadView. No edit, finalize, comments, or copy actions, and no dashboard
 * navigation - the viewer may be anonymous. No fetch or business logic here
 * (§14.1); the error/empty states render inline (§16.1).
 */
import { useSharedTicket } from "../../hooks/queries/useTicketQueries";
import { TicketReadView } from "./TicketReadView";

interface SharedTicketViewProps {
  token: string;
}

export function SharedTicketView({ token }: SharedTicketViewProps) {
  const { data, isLoading, error } = useSharedTicket(token);

  return (
    <main className="wizard">
      <header className="wizard-header">
        <div className="wizard-topline">
          <div className="wizard-brand">
            <img
              className="wizard-logo"
              src="/logo.webp"
              alt=""
              aria-hidden
              width={32}
              height={32}
            />
            <h1 className="wizard-title">PM Ticket Tool</h1>
          </div>
        </div>
      </header>

      {isLoading && <p className="field-hint">Loading ticket…</p>}

      {!isLoading && (error || !data) && (
        <p className="field-hint">
          This shared ticket link is invalid or no longer available.
        </p>
      )}

      {!isLoading && data && (
        <section className="step-panel ticket-view">
          <header className="ticket-header">
            <h2 className="step-heading">Ticket</h2>
            <span className={`ticket-status ticket-status-${data.status}`}>
              {data.status} · v{data.version}
            </span>
          </header>
          <TicketReadView ticket={data} />
        </section>
      )}
    </main>
  );
}
