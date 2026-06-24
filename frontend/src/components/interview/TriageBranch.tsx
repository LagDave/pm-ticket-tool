/**
 * TriageBranch - the two-speed router after request entry (spec 7 T3, §12.3). It
 * triages the session through the useTriageSession query (§14.3, §15.1): the
 * backend classifies the request `simple` or `scoped` and returns the route. A
 * `simple` result offers to jump straight to drafting; a `scoped` result offers
 * to start the interview. The override control is always present - the PM can
 * force the full interview from a simple result, or skip a scoped result straight
 * to drafting (spec What: the classification is never a hard gate).
 *
 * The trigger is React Query server state, not a ref-guarded effect+mutation
 * (§15.1): the query auto-fetches once the session id is present, so the outcome
 * reliably lands on the mounted instance even under React StrictMode's dev
 * double-mount (the prior ref-guarded mutation skipped its surviving instance and
 * hung the UI on "Sizing up your request"). The backend triage endpoint is
 * idempotent - it classifies once, then returns the persisted label on any
 * re-fetch/re-mount - so the auto-fetch is cheap and stable. A component renders +
 * delegates: routing is handed to the parent via onRouted; no fetch or business
 * logic here (§14.1). Failures render the retry panel off the query's error state
 * (§16.1). Mirrors the QuestionBatch / TicketStep generate-then-render shape.
 */
import { useEffect, useState } from "react";
import { ThinkingLoader } from "../ui/ThinkingLoader";
import { useTriageSession } from "../../hooks/queries/useInterviewSessionQueries";
import type { TriageRoute } from "../../types/interview";

interface TriageBranchProps {
  sessionId: number;
  /** Called with the path the wizard should take once the PM confirms (spec 7 T3). */
  onRouted: (route: TriageRoute) => void;
}

/** How long the green "done" check holds before the result reveals, in ms. */
const SETTLE_HOLD_MS = 950;

export function TriageBranch({ sessionId, onRouted }: TriageBranchProps) {
  const triage = useTriageSession(sessionId);

  const outcome = triage.data;

  // Once the classification lands, hold on a green check for a beat before the
  // result reveals, so the screen doesn't snap. UI state only (§15.2).
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => setSettled(true), SETTLE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  // Classifying, or the auto-run hasn't produced a result yet - show the animated
  // loader; when the outcome arrives, it flips to a green check (Item 3).
  if (triage.isPending || (!outcome && !triage.isError) || (outcome && !settled)) {
    return (
      <section className="step-panel">
        <h2 className="step-heading">Sizing up your request</h2>
        <ThinkingLoader
          done={Boolean(outcome)}
          doneLabel="Got it. Routing you now…"
        />
      </section>
    );
  }

  // The classification failed outright (rare - the backend defaults to scoped).
  // Offer a retry and a manual route so the PM is never stuck.
  if (!outcome) {
    return (
      <section className="step-panel">
        <h2 className="step-heading">Triage didn&apos;t complete</h2>
        <p className="field-hint">
          We couldn&apos;t classify the request. Retry, or start the full
          feature scope.
        </p>
        <div className="step-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void triage.refetch()}
            disabled={triage.isFetching}
          >
            Retry triage
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onRouted("interview")}
          >
            Start feature scoping
          </button>
        </div>
      </section>
    );
  }

  const isSimple = outcome.result === "simple";

  return (
    <section className="step-panel">
      <h2 className="step-heading">
        {isSimple ? "This looks straightforward" : "This needs a few decisions"}
      </h2>
      <p className="field-hint">
        {isSimple
          ? "We can draft a ticket from your request directly, no feature scope needed. You can still run the full feature scope if you'd rather."
          : "There are open product decisions here, so we'll walk through a short feature scope before drafting. You can skip straight to a draft if you prefer."}
      </p>

      <div className="step-actions">
        {isSimple ? (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={() => onRouted("ticket")}
            >
              Draft the ticket
            </button>
            {/* Override: force the full interview from a simple result (spec What). */}
            <button
              type="button"
              className="secondary-button"
              onClick={() => onRouted("interview")}
            >
              Run the full feature scope instead
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={() => onRouted("interview")}
            >
              Start feature scoping
            </button>
            {/* Override the other way: skip a scoped result straight to drafting. */}
            <button
              type="button"
              className="secondary-button"
              onClick={() => onRouted("ticket")}
            >
              Skip to a draft anyway
            </button>
          </>
        )}
      </div>
    </section>
  );
}
