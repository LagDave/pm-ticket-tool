/**
 * Dashboard - the app's landing screen (spec 4 T4). Lists the owner's sessions
 * paginated (useSessions, §15.1) with a status filter and page controls, a "new
 * session" entry, and per-row actions wired to the page's handlers. Owns only UI
 * state - the page number, the status filter, and which session is being opened
 * for its ticket (§15.2); all server data is React Query (§15.1). No fetch or
 * business logic here (§14.1); errors surface via the hooks' toast (§16.3) and an
 * inline error state. Other pages are not imported (§12.4). Typed, no any (§17.2).
 */
import { useEffect, useState } from "react";
import { SessionList } from "../components/dashboard/SessionList";
import { LoadingLine } from "../components/ui/LoadingLine";
import {
  useCloneSession,
  useResume,
  useSessions,
} from "../hooks/queries/useInterviewSessionQueries";
import { toast } from "../lib/toast";
import type { InterviewSession, SessionStatus } from "../types/interview";
import { WIZARD_STEP, type WizardStep } from "./InterviewWizard";

interface DashboardProps {
  /** Launch the wizard for a session at a step (new session or resume, spec 4 T5). */
  onOpenSession: (sessionId: number | null, step: WizardStep) => void;
  /** Open a ticket read-only by its id (spec 4 T6). */
  onViewTicket: (ticketId: number) => void;
}

/** Page size for the dashboard list. Named, not magic (§4.2). */
const PAGE_SIZE = 10;

/** The status filter choices, including "all" (no filter). */
const STATUS_FILTERS: ReadonlyArray<{ value: SessionStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_input", label: "Awaiting input" },
  { value: "complete", label: "Complete" },
];

/** Resume lands on the ticket step for a finished session, else the interview step. */
function resumeStep(status: SessionStatus): WizardStep {
  return status === "complete" ? WIZARD_STEP.ticket : WIZARD_STEP.interview;
}

export function Dashboard({ onOpenSession, onViewTicket }: DashboardProps) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  // The session whose ticket the PM asked to view; drives the resume-state fetch
  // that resolves its ticket id (spec 4 T6).
  const [ticketSessionId, setTicketSessionId] = useState<number | null>(null);

  const { data, isLoading, error } = useSessions({
    page,
    limit: PAGE_SIZE,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const clone = useCloneSession();
  const resume = useResume(ticketSessionId);

  // Once the resume-state for a "view ticket" click resolves, route to the ticket
  // view if one exists, otherwise tell the PM there isn't one yet.
  useEffect(() => {
    if (ticketSessionId === null || !resume.data) return;
    if (resume.data.ticketId !== null) {
      onViewTicket(resume.data.ticketId);
    } else {
      toast.error("This session has no ticket yet.");
    }
    setTicketSessionId(null);
  }, [resume.data, ticketSessionId, onViewTicket]);

  const handleResume = (session: InterviewSession): void => {
    onOpenSession(session.id, resumeStep(session.status));
  };

  const handleReRun = (session: InterviewSession): void => {
    // A re-run is a fresh session from the same request, so it is triaged like
    // any new request (spec 7) - not routed straight into the interview.
    clone.mutate(session.id, {
      onSuccess: (created) => onOpenSession(created.id, WIZARD_STEP.triage),
    });
  };

  const handleFilterChange = (value: SessionStatus | "all"): void => {
    setStatusFilter(value);
    setPage(1); // a new filter starts at the first page
  };

  const totalPages = data?.totalPages ?? 1;

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="wizard-brand">
          <img className="wizard-logo" src="/logo.png" alt="" aria-hidden width={32} height={32} />
          <h1 className="wizard-title">Your sessions</h1>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenSession(null, WIZARD_STEP.request)}
        >
          New session
        </button>
      </header>

      <div className="filter-bar">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={
              "filter-chip" + (statusFilter === filter.value ? " is-active" : "")
            }
            onClick={() => handleFilterChange(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading && <LoadingLine label="Loading sessions…" />}
      {error && (
        <p className="field-hint">Could not load your sessions. Try again.</p>
      )}

      {data && (
        <>
          <SessionList
            sessions={data.items}
            isCloning={clone.isPending}
            onResume={handleResume}
            onReRun={handleReRun}
            onViewTicket={(session) => setTicketSessionId(session.id)}
          />
          {totalPages > 1 && (
            <div className="pager">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="pager-status">
                Page {data.page} of {totalPages}
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
