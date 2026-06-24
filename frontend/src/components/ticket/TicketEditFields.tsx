/**
 * TicketEditFields - the inline-edit form for a draft ticket (spec T4/What, §12.3).
 * Seeds local form state from the current ticket, then saves through a
 * version-guarded PATCH mutation (the hook carries the optimistic-concurrency
 * version; a stale save surfaces a toast, §16.3). Editable: story, effort,
 * priority, context, and criteria; the generated rich sections are display-only
 * (spec Out Of Scope). A component renders + delegates; no fetch, no business
 * logic (§14.1). Typed throughout, no any (§17.2).
 */
import { useState } from "react";
import { useUpdateTicket } from "../../hooks/queries/useTicketQueries";
import { EFFORT_TIERS, PRIORITY_TIERS } from "../../types/ticket";
import type {
  AcceptanceCriterion,
  EffortTier,
  Ticket,
  TicketPriority,
} from "../../types/ticket";

interface TicketEditFieldsProps {
  ticket: Ticket;
  /** Leave edit mode (called after a successful save or on cancel). */
  onDone: () => void;
}

export function TicketEditFields({ ticket, onDone }: TicketEditFieldsProps) {
  const update = useUpdateTicket(ticket.id);
  const [userStory, setUserStory] = useState(ticket.user_story ?? "");
  const [effort, setEffort] = useState<EffortTier>(ticket.effort ?? "M");
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority ?? "medium");
  const [contextSummary, setContextSummary] = useState(ticket.context_summary ?? "");
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(
    ticket.acceptance_criteria ?? [],
  );

  const handleSave = (): void => {
    update.mutate(
      {
        expectedVersion: ticket.version,
        userStory: userStory.trim(),
        effort,
        priority,
        contextSummary: contextSummary.trim(),
        acceptanceCriteria: criteria,
      },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <div className="ticket-edit">
      <label className="field-label" htmlFor="edit-story">
        User story
      </label>
      <textarea
        id="edit-story"
        className="request-input"
        rows={2}
        value={userStory}
        onChange={(event) => setUserStory(event.target.value)}
        disabled={update.isPending}
      />

      <label className="field-label" htmlFor="edit-effort">
        Effort tier
      </label>
      <select
        id="edit-effort"
        className="ticket-effort-select"
        value={effort}
        onChange={(event) => setEffort(event.target.value as EffortTier)}
        disabled={update.isPending}
      >
        {EFFORT_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor="edit-priority">
        Priority
      </label>
      <select
        id="edit-priority"
        className="ticket-effort-select"
        value={priority}
        onChange={(event) => setPriority(event.target.value as TicketPriority)}
        disabled={update.isPending}
      >
        {PRIORITY_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </option>
        ))}
      </select>

      <CriteriaEditor
        criteria={criteria}
        disabled={update.isPending}
        onChange={setCriteria}
      />

      <label className="field-label" htmlFor="edit-context">
        Context
      </label>
      <textarea
        id="edit-context"
        className="request-input"
        rows={3}
        value={contextSummary}
        onChange={(event) => setContextSummary(event.target.value)}
        disabled={update.isPending}
      />

      <div className="step-actions">
        <button
          type="button"
          className="primary-button"
          onClick={handleSave}
          disabled={update.isPending || userStory.trim().length === 0}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onDone}
          disabled={update.isPending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The editable Given/When/Then list - its own component to keep the parent lean (§13.2). */
function CriteriaEditor({
  criteria,
  disabled,
  onChange,
}: {
  criteria: AcceptanceCriterion[];
  disabled: boolean;
  onChange: (next: AcceptanceCriterion[]) => void;
}) {
  const setField = (
    index: number,
    field: keyof AcceptanceCriterion,
    value: string,
  ): void => {
    onChange(criteria.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  return (
    <fieldset className="ticket-criteria-edit">
      <legend className="field-label">Acceptance criteria</legend>
      {criteria.map((criterion, index) => (
        <div key={index} className="criterion-edit-row">
          {(["given", "when", "then"] as const).map((field) => (
            <input
              key={field}
              className="criterion-input"
              aria-label={`Criterion ${index + 1} ${field}`}
              placeholder={`${field[0].toUpperCase()}${field.slice(1)}…`}
              value={criterion[field]}
              onChange={(event) => setField(index, field, event.target.value)}
              disabled={disabled}
            />
          ))}
        </div>
      ))}
    </fieldset>
  );
}
