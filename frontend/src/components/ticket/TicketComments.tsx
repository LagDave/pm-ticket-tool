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
    <section className="mt-6 pt-5 border-t border-line">
      <h3 className="eyebrow mb-3">Comments</h3>

      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="list-none m-0 mb-4 p-0 flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="surface-2 px-3.5 py-2.5"
            >
              <p className="m-0 mb-1 text-sm text-ink leading-snug">{comment.body}</p>
              <span className="eyebrow text-faint">
                user {comment.author_user_id} ·{" "}
                {new Date(comment.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
        <label className="eyebrow" htmlFor={`comment-${ticketId}`}>
          Add a comment
        </label>
        <textarea
          id={`comment-${ticketId}`}
          className="field"
          rows={3}
          placeholder="Note a refinement or a question for engineering…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={addComment.isPending}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <button type="submit" className="btn" disabled={!canSubmit}>
            {addComment.isPending ? "Adding…" : "Add comment"}
          </button>
        </div>
      </form>
    </section>
  );
}
