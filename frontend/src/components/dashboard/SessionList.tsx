/**
 * SessionList — the dashboard's table of the owner's sessions with per-row
 * actions (spec 4 T4, §12.3). A component renders + delegates: the page passes
 * the current page of sessions (from useSessions, §15.1) and the action handlers;
 * this file owns no fetching and no business logic (§14.1). Each row shows status,
 * a request snippet, and last-updated, plus the resume / re-run / view-ticket
 * actions. Typed, no any (§17.2).
 */
import type { InterviewSession, SessionStatus } from "../../types/interview";

interface SessionListProps {
  sessions: InterviewSession[];
  /** True while a re-run is in flight, to disable the buttons. */
  isCloning: boolean;
  onResume: (session: InterviewSession) => void;
  onReRun: (session: InterviewSession) => void;
  onViewTicket: (session: InterviewSession) => void;
}

/** How many characters of the original request to show in a row. Named, not magic. */
const SNIPPET_LENGTH = 90;

/** Human-readable labels for each status (the row badge). */
const STATUS_LABEL: Record<SessionStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  awaiting_input: "Awaiting input",
  complete: "Complete",
  archived: "Archived",
};

/** A session is resumable while it is not yet complete or archived. */
function isResumable(status: SessionStatus): boolean {
  return status !== "complete" && status !== "archived";
}

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SNIPPET_LENGTH
    ? `${trimmed.slice(0, SNIPPET_LENGTH)}…`
    : trimmed;
}

export function SessionList({
  sessions,
  isCloning,
  onResume,
  onReRun,
  onViewTicket,
}: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="field-hint">No sessions yet. Start a new one above.</p>;
  }

  return (
    <ul className="session-list">
      {sessions.map((session) => (
        <li key={session.id} className="session-row">
          <div className="session-main">
            <span className={`session-status session-status-${session.status}`}>
              {STATUS_LABEL[session.status]}
            </span>
            <p className="session-snippet">{snippet(session.original_request)}</p>
            <span className="session-meta">
              Updated {new Date(session.updated_at).toLocaleString()}
            </span>
          </div>
          <div className="session-actions">
            {isResumable(session.status) ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => onResume(session)}
              >
                {session.status === "awaiting_input" ? "Finish" : "Resume"}
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onViewTicket(session)}
                disabled={session.status !== "complete"}
              >
                View ticket
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => onReRun(session)}
              disabled={isCloning}
            >
              Re-run
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
