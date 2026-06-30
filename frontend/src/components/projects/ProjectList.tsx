/**
 * ProjectList - the manager's table of the owner's projects with per-row actions
 * (§12.3). A component renders + delegates: the page passes the projects (from
 * useProjects, §15.1) and the action handlers; this file owns no fetching and no
 * business logic (§14.1). Each row shows the name, an optional description, and
 * last-updated, plus open / edit / delete. Delete is a two-step inline confirm
 * because it cascades to the project's bits. Typed, no any (§17.2).
 */
import { useState } from "react";
import type { Project } from "../../types/project";

interface ProjectListProps {
  projects: Project[];
  /** True while a delete is in flight, to disable the confirm buttons. */
  isDeleting: boolean;
  /** Open a project's detail (its bits manager). */
  onOpen: (project: Project) => void;
  /** Open the edit form for a project. */
  onEdit: (project: Project) => void;
  /** Permanently delete a project (after the inline confirm). */
  onDelete: (project: Project) => void;
}

export function ProjectList({
  projects,
  isDeleting,
  onOpen,
  onEdit,
  onDelete,
}: ProjectListProps) {
  // Which row is showing its delete confirm (UI-only state, §15.2). Delete
  // cascades to the project's bits, so it is a two-step inline confirm.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  if (projects.length === 0) {
    return <p className="text-sm text-muted">No projects yet. Create one above.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {projects.map((project) => (
        <li
          key={project.id}
          className="surface card-hover flex flex-wrap items-center justify-between gap-3 p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{project.name}</p>
            {project.description && (
              <p className="truncate text-sm text-muted">{project.description}</p>
            )}
            <span className="eyebrow mt-1 block">
              Updated {new Date(project.updated_at).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpen(project)}
            >
              Open
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onEdit(project)}
            >
              Edit
            </button>
            {confirmingId === project.id ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    onDelete(project);
                    setConfirmingId(null);
                  }}
                  disabled={isDeleting}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmingId(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmingId(project.id)}
                aria-label={`Delete project: ${project.name}`}
              >
                Delete
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
