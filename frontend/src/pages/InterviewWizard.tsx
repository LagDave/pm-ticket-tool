/**
 * InterviewWizard - the step-wizard shell page (§12.2). Owns only UI step state
 * (§15.2); session and engine data come from the hooks/cache (§15.1). Step 1 is
 * request entry; after entry the request is triaged (spec 7) into the two-speed
 * path - a `simple` request jumps straight to the ticket step (spec 3), a
 * `scoped` one enters the interview engine (spec 2). The PM can override either
 * way from the triage branch. Step "Interview" is the question-batch step; step
 * "Ticket" generates and owns the durable ticket. Other pages are not imported
 * (§12.4).
 *
 * Spec 4 (dashboard): the wizard is launchable from the dashboard for an existing
 * session at a chosen step (resume). `initialSessionId`/`initialStep` seed the
 * position; resume on the interview step lands on the next unanswered batch
 * because QuestionBatch replays the persisted turns (spec 2). `onExit` returns to
 * the dashboard.
 */
import { motion } from "framer-motion";
import { useState } from "react";
import { QuestionBatch } from "../components/interview/QuestionBatch";
import { RequestEntry } from "../components/interview/RequestEntry";
import { TriageBranch } from "../components/interview/TriageBranch";
import { TicketStep } from "../components/ticket/TicketStep";
import { SPRING_SOFT } from "../lib/motion";
import { useSession } from "../hooks/queries/useInterviewSessionQueries";
import type { InterviewSession, TriageRoute } from "../types/interview";

/** The rail labels - the durable destinations a session lands on. Triage is a
 *  transient routing interstitial between Request and these, not a rail dot. */
const STEPS = ["Request", "Feature Scope", "Ticket"] as const;

/**
 * The wizard step indices, named so resume routing reads clearly (spec 4 T5).
 * `triage` sits between request and the branch destinations; it shares the
 * Request rail dot (the PM has not yet "left" request entry from the rail's
 * point of view) and routes to interview or ticket once classified (spec 7).
 */
export const WIZARD_STEP = { request: 0, triage: 1, interview: 2, ticket: 3 } as const;
export type WizardStep = (typeof WIZARD_STEP)[keyof typeof WIZARD_STEP];

/** Map an internal step to the rail index it lights up (triage shares Request). */
const RAIL_INDEX: Record<WizardStep, number> = {
  [WIZARD_STEP.request]: 0,
  [WIZARD_STEP.triage]: 0,
  [WIZARD_STEP.interview]: 1,
  [WIZARD_STEP.ticket]: 2,
};

interface InterviewWizardProps {
  /** Resume an existing session (spec 4); omitted for a fresh "new session" flow. */
  initialSessionId?: number | null;
  /** Step to open on when resuming; defaults to the request step for a new flow. */
  initialStep?: WizardStep;
  /** Return to the dashboard (spec 4). When absent, the wizard runs standalone. */
  onExit?: () => void;
}

export function InterviewWizard({
  initialSessionId = null,
  initialStep = WIZARD_STEP.request,
  onExit,
}: InterviewWizardProps = {}) {
  const [stepIndex, setStepIndex] = useState<WizardStep>(initialStep);
  const [sessionId, setSessionId] = useState<number | null>(initialSessionId);

  // Read back the session from the cache to show its request text (resume seeds
  // this from the dashboard's prior fetch; new flows fill it after create).
  const { data: session } = useSession(sessionId);

  const railIndex = RAIL_INDEX[stepIndex];

  const handleCreated = (created: InterviewSession): void => {
    setSessionId(created.id);
    // After entry, triage decides the path (spec 7) - no longer straight to interview.
    setStepIndex(WIZARD_STEP.triage);
  };

  // Triage routed us: `ticket` jumps to drafting (spec 3), `interview` to the loop (spec 2).
  const handleRouted = (route: TriageRoute): void => {
    setStepIndex(route === "ticket" ? WIZARD_STEP.ticket : WIZARD_STEP.interview);
  };

  const handleInterviewComplete = (): void => {
    setStepIndex(WIZARD_STEP.ticket);
  };

  const restart = (): void => {
    // From the dashboard, "start over" returns there; standalone, it resets.
    if (onExit) {
      onExit();
      return;
    }
    setStepIndex(WIZARD_STEP.request);
    setSessionId(null);
  };

  return (
    <main className="wizard">
      <header className="wizard-header">
        <div className="wizard-topline">
          <div className="wizard-brand">
            <img className="wizard-logo" src="/logo.webp" alt="" aria-hidden width={40} height={40} />
            <h1 className="wizard-title">PM Ticket Tool</h1>
          </div>
          {onExit && (
            <button type="button" className="link-button" onClick={onExit}>
              ← Dashboard
            </button>
          )}
        </div>
        <ol className="step-rail">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={
                "step-dot" +
                (index === railIndex ? " is-active" : "") +
                (index < railIndex ? " is-done" : "")
              }
            >
              <span className="step-number">{index + 1}</span>
              <span className="step-name">{label}</span>
            </li>
          ))}
        </ol>
      </header>

      {/* Step transition - entrance-only, keyed on the step so each step mounts
          fresh and animates in. Deliberately NOT wrapped in AnimatePresence with
          an exit: the interview step renders its own nested AnimatePresence
          (QuestionBatch's per-batch deck), and a parent presence/exit deadlocks
          on that nested exit - leaving the old step on screen while the new one
          mounts. A keyed motion.div re-mounts cleanly; the batch-level transition
          inside QuestionBatch still animates the deck swap. */}
      <motion.div
        key={stepIndex}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
      >
          {stepIndex === WIZARD_STEP.request && (
            <RequestEntry onCreated={handleCreated} />
          )}

          {stepIndex === WIZARD_STEP.triage && sessionId !== null && (
            <>
              {session && (
                <blockquote className="request-echo">
                  {session.original_request}
                </blockquote>
              )}
              <TriageBranch sessionId={sessionId} onRouted={handleRouted} />
              <div className="step-actions">
                <button type="button" className="secondary-button" onClick={restart}>
                  {onExit ? "Back to dashboard" : "Start over"}
                </button>
              </div>
            </>
          )}

          {stepIndex === WIZARD_STEP.interview && sessionId !== null && (
            <>
              {session && (
                <blockquote className="request-echo">
                  {session.original_request}
                </blockquote>
              )}
              <QuestionBatch
                sessionId={sessionId}
                onComplete={handleInterviewComplete}
              />
              <div className="step-actions">
                <button type="button" className="secondary-button" onClick={restart}>
                  {onExit ? "Back to dashboard" : "Start over"}
                </button>
              </div>
            </>
          )}

          {stepIndex === WIZARD_STEP.ticket && sessionId !== null && (
            <>
              <TicketStep sessionId={sessionId} />
              <div className="step-actions">
                <button type="button" className="secondary-button" onClick={restart}>
                  {onExit ? "Back to dashboard" : "Start over"}
                </button>
              </div>
            </>
          )}
        </motion.div>
    </main>
  );
}
