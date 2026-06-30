/**
 * SessionList - the dashboard's table of the owner's sessions with per-row
 * actions (spec 4 T4, §12.3). A component renders + delegates: the page passes
 * the current page of sessions (from useSessions, §15.1) and the action handlers;
 * this file owns no fetching and no business logic (§14.1). Each row shows status,
 * the generated title as the primary label (the request snippet when no title
 * yet) with the raw request as a muted subtitle, last-updated, plus the resume /
 * re-run / view-ticket actions (all neutral, no accent). Typed, no any (§17.2).
 */
import { Check, FileText, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { InterviewSession, SessionStatus } from "../../types/interview";

interface SessionListProps {
  sessions: InterviewSession[];
  /** True while a re-run is in flight, to disable the buttons. */
  isCloning: boolean;
  /** True while a delete is in flight, to disable the confirm buttons. */
  isDeleting: boolean;
  onResume: (session: InterviewSession) => void;
  onReRun: (session: InterviewSession) => void;
  onViewTicket: (session: InterviewSession) => void;
  /** Permanently delete a session (after the inline confirm). */
  onDelete: (session: InterviewSession) => void;
}

/** How many characters of the original request to show in a row. Named, not magic. */
const SNIPPET_LENGTH = 90;

/** How many characters of the title to show as the primary label. Named, not magic. */
const TITLE_LENGTH = 90;

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

/** Truncate a string to a max length with an ellipsis. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * The primary label for a row: the generated title when present, else the
 * request snippet (title is null until generated, or if generation failed).
 */
function primaryLabel(session: InterviewSession): string {
  const title = session.title?.trim();
  return title ? truncate(title, TITLE_LENGTH) : truncate(session.original_request, SNIPPET_LENGTH);
}

/**
 * The muted subtitle: the raw request, shown only when a distinct title is the
 * primary label (so we don't echo the same text twice).
 */
function subtitle(session: InterviewSession): string | null {
  const title = session.title?.trim();
  if (!title) return null;
  return truncate(session.original_request, SNIPPET_LENGTH);
}

export function SessionList({
  sessions,
  isCloning,
  isDeleting,
  onResume,
  onReRun,
  onViewTicket,
  onDelete,
}: SessionListProps) {
  // Which row is showing its delete confirm (UI-only state, §15.2). Delete is
  // destructive and cascades, so it is a two-step inline confirm, never one click.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  if (sessions.length === 0) {
    return <p className="field-hint">No sessions yet. Start a new one above.</p>;
  }

  return (
    <ul className="session-list">
      {sessions.map((session) => (
        <li key={session.id} className="session-row">
          <div className="session-main">
            <p className="session-title">{primaryLabel(session)}</p>
            <div className="session-sub">
              <span className={`session-status session-status-${session.status}`}>
                {STATUS_LABEL[session.status]}
              </span>
              {subtitle(session) && (
                <span className="session-snippet">{subtitle(session)}</span>
              )}
              <span className="session-meta">
                {new Date(session.updated_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="session-actions">
            {isResumable(session.status) ? (
              <button
                type="button"
                className="icon-button is-resume"
                onClick={() => onResume(session)}
                aria-label={session.status === "awaiting_input" ? "Finish" : "Resume"}
                title={session.status === "awaiting_input" ? "Finish" : "Resume"}
              >
                <Play size={16} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="icon-button"
                onClick={() => onViewTicket(session)}
                disabled={session.status !== "complete"}
                aria-label="View ticket"
                title="View ticket"
              >
                <FileText size={16} aria-hidden />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => onReRun(session)}
              disabled={isCloning}
              aria-label="Re-run"
              title="Re-run"
            >
              <RotateCcw size={16} aria-hidden />
            </button>
            {confirmingId === session.id ? (
              <>
                <button
                  type="button"
                  className="icon-button is-danger"
                  onClick={() => {
                    onDelete(session);
                    setConfirmingId(null);
                  }}
                  disabled={isDeleting}
                  aria-label={`Confirm delete: ${primaryLabel(session)}`}
                  title="Confirm delete"
                >
                  <Check size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setConfirmingId(null)}
                  disabled={isDeleting}
                  aria-label="Cancel delete"
                  title="Cancel"
                >
                  <X size={16} aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-button is-delete"
                onClick={() => setConfirmingId(session.id)}
                aria-label={`Delete session: ${primaryLabel(session)}`}
                title="Delete"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
