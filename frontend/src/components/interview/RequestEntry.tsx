/**
 * RequestEntry - wizard step 1 (§12.3). Captures the PM's initial request,
 * creates a session via the hook (§14.3), and calls onCreated to advance. A
 * component renders + delegates; no fetch, no business logic here (§14.1).
 */
import { useState } from "react";
import { useCreateSession } from "../../hooks/queries/useInterviewSessionQueries";
import { useProjects } from "../../hooks/queries/useProjectQueries";
import type { InterviewSession } from "../../types/interview";

interface RequestEntryProps {
  onCreated: (session: InterviewSession) => void;
}

/** Sentinel <select> value for "no project" - the session stays ungrounded. */
const NO_PROJECT = "";

export function RequestEntry({ onCreated }: RequestEntryProps) {
  const [request, setRequest] = useState("");
  // Which project the interview is attached to (optional). UI state only (§15.2).
  const [projectChoice, setProjectChoice] = useState<string>(NO_PROJECT);
  const createSession = useCreateSession();
  const { data: projects } = useProjects();

  const trimmed = request.trim();
  const canSubmit = trimmed.length > 0 && !createSession.isPending;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    const projectId = projectChoice === NO_PROJECT ? undefined : Number(projectChoice);
    createSession.mutate(
      { originalRequest: trimmed, projectId },
      { onSuccess: (session) => onCreated(session) },
    );
  };

  return (
    <form className="step-panel" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="request">
        What do you want to build?
      </label>
      <p className="field-hint">
        Describe the feature or change in plain language. We&apos;ll turn it into
        a structured ticket through a short feature scope.
      </p>
      <textarea
        id="request"
        className="request-input"
        rows={6}
        placeholder="e.g. Add a magic-link login so users can sign in without a password."
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        disabled={createSession.isPending}
      />
      {projects && projects.length > 0 && (
        <label className="project-picker">
          <span className="project-picker-label">Project (optional)</span>
          <select
            className="ticket-effort-select"
            value={projectChoice}
            onChange={(event) => setProjectChoice(event.target.value)}
            disabled={createSession.isPending}
          >
            <option value={NO_PROJECT}>No project</option>
            {projects.map((project) => (
              <option key={project.id} value={String(project.id)}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="step-actions">
        <button type="submit" className="primary-button" disabled={!canSubmit}>
          {createSession.isPending ? "Starting…" : "Start feature scoping"}
        </button>
      </div>
    </form>
  );
}
