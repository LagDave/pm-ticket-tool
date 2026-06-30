/**
 * RequestEntry - wizard step 1 (§12.3). Captures the PM's initial request,
 * creates a session via the hook (§14.3), and calls onCreated to advance. A
 * component renders + delegates; no fetch, no business logic here (§14.1).
 */
import { useState } from "react";
import { useCreateSession } from "../../hooks/queries/useInterviewSessionQueries";
import { useProjects } from "../../hooks/queries/useProjectQueries";
import { Select } from "../ui/Select";
import type { InterviewSession } from "../../types/interview";

interface RequestEntryProps {
  onCreated: (session: InterviewSession) => void;
  /**
   * Pre-selected project for the new session (the shell sidebar's per-project
   * "new session" passes the group's project). Omitted/null leaves it ungrounded.
   */
  initialProjectId?: number | null;
}

/** Sentinel <select> value for "no project" - the session stays ungrounded. */
const NO_PROJECT = "";

export function RequestEntry({ onCreated, initialProjectId = null }: RequestEntryProps) {
  const [request, setRequest] = useState("");
  // Which project the interview is attached to (optional). UI state only (§15.2).
  // Seeded from the sidebar group the "new session" was launched from.
  const [projectChoice, setProjectChoice] = useState<string>(
    initialProjectId == null ? NO_PROJECT : String(initialProjectId),
  );
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
    <form className="surface flex flex-col gap-3 p-5" onSubmit={handleSubmit}>
      <label className="block text-base font-semibold text-ink" htmlFor="request">
        What do you want to build?
      </label>
      <p className="text-sm text-muted">
        Describe the feature or change in plain language. We&apos;ll turn it into
        a structured ticket through a short feature scope.
      </p>
      <textarea
        id="request"
        className="field min-h-[84px] resize-y leading-relaxed"
        rows={6}
        placeholder="e.g. Add a magic-link login so users can sign in without a password."
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        disabled={createSession.isPending}
      />
      {projects && projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">Project (optional)</span>
          <div className="max-w-[360px]">
            <Select
              value={projectChoice}
              options={[
                { value: NO_PROJECT, label: "No project" },
                ...projects.map((project) => ({
                  value: String(project.id),
                  label: project.name,
                })),
              ]}
              onChange={setProjectChoice}
              disabled={createSession.isPending}
              ariaLabel="Project"
            />
          </div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {createSession.isPending ? "Starting…" : "Start feature scoping"}
        </button>
      </div>
    </form>
  );
}
