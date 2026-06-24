/**
 * TicketComments - lists a ticket's comments and adds new ones (spec T4, §12.3).
 * Server state (the comments) comes from the ticket query via props; only the
 * in-progress draft is local UI state (§15.1). The add mutation lives in the
 * useTicketQueries hook and surfaces errors via toast (§16.3); no fetch here.
 */
import { useState } from "react";
import { useAddTicketComment } from "../../hooks/queries/useTicketQueries";
import type { TicketComment } from "../../types/ticket";

interface TicketCommentsProps {
  ticketId: number;
  comments: TicketComment[];
}

export function TicketComments({ ticketId, comments }: TicketCommentsProps) {
  const [draft, setDraft] = useState("");
  const addComment = useAddTicketComment(ticketId);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !addComment.isPending;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    addComment.mutate({ body: trimmed }, { onSuccess: () => setDraft("") });
  };

  return (
    <section className="ticket-comments">
      <h3 className="ticket-section-heading">Comments</h3>

      {comments.length === 0 ? (
        <p className="field-hint">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="comment-item">
              <p className="comment-body">{comment.body}</p>
              <span className="comment-meta">
                user {comment.author_user_id} ·{" "}
                {new Date(comment.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="comment-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor={`comment-${ticketId}`}>
          Add a comment
        </label>
        <textarea
          id={`comment-${ticketId}`}
          className="request-input"
          rows={3}
          placeholder="Note a refinement or a question for engineering…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={addComment.isPending}
        />
        <div className="step-actions">
          <button type="submit" className="secondary-button" disabled={!canSubmit}>
            {addComment.isPending ? "Adding…" : "Add comment"}
          </button>
        </div>
      </form>
    </section>
  );
}
