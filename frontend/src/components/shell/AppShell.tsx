/**
 * AppShell — the authenticated two-pane shell (plan 07012026-deveasy-style-two-pane-shell).
 * A persistent sidebar (sessions grouped by project) sits beside a main pane that
 * renders the current view: the empty/landing state, a session (the interview
 * wizard, which opens a complete session straight to its ticket), or the projects
 * screens. Replaces the old full-screen view-swap in App.tsx.
 *
 * Owns only UI navigation state (§15.2) — the active pane view; server data and
 * mutations come from the hooks (§15.1). The public ?ticket= shared view is NOT
 * rendered here — App.tsx keeps it outside the shell (no sidebar for anonymous
 * viewers). Typed, no any (§17.2).
 */
import { useState } from "react";
import {
  useCloneSession,
} from "../../hooks/queries/useInterviewSessionQueries";
import { InterviewWizard, WIZARD_STEP, type WizardStep } from "../../pages/InterviewWizard";
import { ProjectDetail } from "../../pages/ProjectDetail";
import { ProjectsManager } from "../../pages/ProjectsManager";
import type { InterviewSession, SessionStatus } from "../../types/interview";
import { SessionSidebar } from "./SessionSidebar";

/** What the main pane is showing. UI navigation state only (§15.2). */
type PaneView =
  | { kind: "empty" }
  | { kind: "session"; session: InterviewSession | null; step: WizardStep; projectId: number | null }
  | { kind: "projects" }
  | { kind: "projectDetail"; projectId: number };

/** Resume lands a finished session on its ticket, else the interview step. */
function resumeStep(status: SessionStatus): WizardStep {
  return status === "complete" ? WIZARD_STEP.ticket : WIZARD_STEP.interview;
}

export function AppShell() {
  const [view, setView] = useState<PaneView>({ kind: "empty" });
  const clone = useCloneSession();

  const activeSessionId = view.kind === "session" ? view.session?.id ?? null : null;

  const openSession = (session: InterviewSession): void =>
    setView({
      kind: "session",
      session,
      step: resumeStep(session.status),
      projectId: session.project_id,
    });

  const newSession = (projectId: number | null): void =>
    setView({ kind: "session", session: null, step: WIZARD_STEP.request, projectId });

  const reRun = (session: InterviewSession): void => {
    // A re-run is a fresh session from the same request — triaged like any new one.
    clone.mutate(session.id, {
      onSuccess: (created) =>
        setView({
          kind: "session",
          session: created,
          step: WIZARD_STEP.triage,
          projectId: created.project_id,
        }),
    });
  };

  return (
    <div className="flex h-full">
      <SessionSidebar
        activeSessionId={activeSessionId}
        onSelectSession={openSession}
        onNewSession={newSession}
        onReRun={reRun}
        isCloning={clone.isPending}
        onOpenProjects={() => setView({ kind: "projects" })}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        {view.kind === "empty" && <EmptyState onNewSession={() => newSession(null)} />}

        {view.kind === "session" && (
          <InterviewWizard
            key={view.session?.id ?? "new"}
            initialSessionId={view.session?.id ?? null}
            initialStep={view.step}
            initialProjectId={view.projectId}
          />
        )}

        {view.kind === "projects" && (
          <ProjectsManager
            onOpenProject={(projectId) => setView({ kind: "projectDetail", projectId })}
            onExit={() => setView({ kind: "empty" })}
          />
        )}

        {view.kind === "projectDetail" && (
          <ProjectDetail
            projectId={view.projectId}
            onBack={() => setView({ kind: "projects" })}
          />
        )}
      </main>
    </div>
  );
}

/** Landing state shown when no session is selected. */
function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <p className="eyebrow mb-3">PM Ticket Tool</p>
      <h1 className="mb-3 font-mono text-2xl font-semibold tracking-tight">
        Pick a session, or start a new one
      </h1>
      <p className="mb-6 max-w-md text-sm text-muted">
        Sessions are grouped by project in the sidebar. Select one to resume it, or
        start a fresh session to turn a request into a structured ticket.
      </p>
      <button type="button" className="btn btn-primary" onClick={onNewSession}>
        New session
      </button>
    </div>
  );
}
