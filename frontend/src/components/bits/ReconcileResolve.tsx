/**
 * ReconcileResolve - the PM's resolve screen for an import plan (spec T11). Shows
 * the reconciliation actions grouped by RECONCILIATION_ACTION_ORDER (conflicts +
 * similars first, so they are cheap to scan and never rubber-stamped — R2). Per
 * action the PM sees the incoming candidate, the agent's reason, and the target
 * bit when present, then picks a choice and edits the final summary. A component
 * renders + delegates (§13.2): it owns only the per-action decision UI state
 * (§15.2) and calls useApplyResolutions (§15.1) — no fetch or business logic here
 * (§14.1); failures surface via the hook's toast (§16.3). Typed, no any (§17.2).
 */
import { useMemo, useState } from "react";
import { useApplyResolutions } from "../../hooks/queries/useProjectQueries";
import {
  BIT_KIND_LABEL,
  RECONCILIATION_ACTION_LABEL,
  RECONCILIATION_ACTION_ORDER,
} from "../../types/project";
import type {
  CandidateBit,
  ReconciliationAction,
  ReconciliationActionKind,
  ReconciliationPlan,
  Resolution,
  ResolutionChoice,
} from "../../types/project";

interface ReconcileResolveProps {
  projectId: number;
  /** The candidates the plan was built from, indexed by ReconciliationAction.incomingIndex. */
  candidates: CandidateBit[];
  /** The reconciliation plan the import returned. */
  plan: ReconciliationPlan;
  /** Resolutions applied successfully — close the resolve view and return to the list. */
  onDone: () => void;
  /**
   * Merge-on-complete provenance (spec T13). OPTIONAL — when the resolve screen is
   * reached from a finalized ticket, the caller passes { source: "merged",
   * sourceTicketId } so the applied bits are stamped with their origin (an audit
   * trail, spec R2). Omitted (the import/manual resolve) leaves the apply
   * unchanged: the server defaults the source to "imported" with no ticket id.
   */
  provenance?: { source: "merged"; sourceTicketId: number };
}

/** The PM's working decision for one action: a choice plus the editable final summary. */
interface Decision {
  choice: ResolutionChoice;
  summary: string;
}

/** The choices offered for a non-insert action (insert is fixed to "insert"). */
const NON_INSERT_CHOICES: readonly { value: ResolutionChoice; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "keep_both", label: "Keep both" },
  { value: "skip", label: "Skip" },
  { value: "force", label: "Force replace" },
];

/**
 * The default choice for each action kind. Inserts insert; updates/similars merge
 * (the agent proposed a merged summary); duplicates skip; conflicts default to
 * keep_both so a contradiction is never silently overwritten — the PM must opt in.
 */
const DEFAULT_CHOICE: Record<ReconciliationActionKind, ResolutionChoice> = {
  insert: "insert",
  update: "merge",
  similar: "merge",
  skip_duplicate: "skip",
  conflict: "keep_both",
};

/** The starting decision for an action: its default choice + the proposed/candidate summary. */
function initialDecision(action: ReconciliationAction, candidate: CandidateBit): Decision {
  return {
    choice: DEFAULT_CHOICE[action.action],
    summary: action.mergedSummary ?? candidate.summary,
  };
}

interface ResolveRowProps {
  action: ReconciliationAction;
  candidate: CandidateBit;
  decision: Decision;
  disabled: boolean;
  onChange: (decision: Decision) => void;
}

/** One action's row: the candidate + reason + the choice control and summary editor. */
function ResolveRow({ action, candidate, decision, disabled, onChange }: ResolveRowProps) {
  const isInsert = action.action === "insert";
  return (
    <li className="surface flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{candidate.bit_key}</span>
        <span className="pill">{BIT_KIND_LABEL[candidate.kind]}</span>
        {action.targetBitId != null && (
          <span className="eyebrow">vs. bit #{action.targetBitId}</span>
        )}
      </div>
      <p className="text-sm text-muted">{action.reason}</p>

      {!isInsert && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resolution choice">
          {NON_INSERT_CHOICES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                "btn " + (decision.choice === option.value ? "btn-primary" : "")
              }
              aria-pressed={decision.choice === option.value}
              onClick={() => onChange({ ...decision, choice: option.value })}
              disabled={disabled}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {decision.choice !== "skip" && (
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Summary to save</span>
          <textarea
            className="field"
            rows={3}
            value={decision.summary}
            onChange={(event) => onChange({ ...decision, summary: event.target.value })}
            disabled={disabled}
          />
        </label>
      )}
    </li>
  );
}

export function ReconcileResolve({
  projectId,
  candidates,
  plan,
  onDone,
  provenance,
}: ReconcileResolveProps) {
  const apply = useApplyResolutions(projectId);

  // One decision per action, keyed by incomingIndex (stable across renders).
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const initial: Record<number, Decision> = {};
    for (const action of plan.actions) {
      const candidate = candidates[action.incomingIndex];
      if (candidate) initial[action.incomingIndex] = initialDecision(action, candidate);
    }
    return initial;
  });

  // Group the actions in the fixed scan order, dropping any that have no candidate
  // and any empty groups, so conflicts + similars lead.
  const groups = useMemo(
    () =>
      RECONCILIATION_ACTION_ORDER.map((kind) => ({
        kind,
        actions: plan.actions.filter(
          (action) => action.action === kind && candidates[action.incomingIndex] !== undefined,
        ),
      })).filter((group) => group.actions.length > 0),
    [plan.actions, candidates],
  );

  const setDecision = (incomingIndex: number, decision: Decision): void => {
    setDecisions((prev) => ({ ...prev, [incomingIndex]: decision }));
  };

  const handleApply = (): void => {
    const resolutions: Resolution[] = plan.actions
      .filter((action) => candidates[action.incomingIndex] !== undefined)
      .map((action) => {
        const candidate = candidates[action.incomingIndex];
        const decision =
          decisions[action.incomingIndex] ?? initialDecision(action, candidate);
        return {
          incomingIndex: action.incomingIndex,
          choice: decision.choice,
          targetBitId: action.targetBitId ?? null,
          // A skip writes nothing, so the summary is irrelevant — send null.
          summary: decision.choice === "skip" ? null : decision.summary.trim(),
        };
      });

    // Spread the merge-on-complete provenance when present (spec T13); for the
    // import/manual resolve it is undefined and the apply is unchanged.
    apply.mutate(
      { candidates, resolutions, ...provenance },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <div className="surface p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">Review the import</h2>
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={apply.isPending}>
          Cancel
        </button>
      </div>
      <p className="mb-5 text-sm text-muted">
        Conflicts and similar bits come first. Pick what to do with each, edit the
        summary if needed, then apply.
      </p>

      {groups.map((group) => (
        <section key={group.kind} className="mb-6">
          <h3 className="eyebrow mb-2">{RECONCILIATION_ACTION_LABEL[group.kind]}</h3>
          <ul className="flex flex-col gap-2">
            {group.actions.map((action) => {
              const candidate = candidates[action.incomingIndex];
              const decision =
                decisions[action.incomingIndex] ?? initialDecision(action, candidate);
              return (
                <ResolveRow
                  key={action.incomingIndex}
                  action={action}
                  candidate={candidate}
                  decision={decision}
                  disabled={apply.isPending}
                  onChange={(next) => setDecision(action.incomingIndex, next)}
                />
              );
            })}
          </ul>
        </section>
      ))}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleApply}
          disabled={apply.isPending}
        >
          {apply.isPending ? "Applying…" : "Apply changes"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={onDone}
          disabled={apply.isPending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
