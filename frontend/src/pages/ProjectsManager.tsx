/**
 * ProjectsManager - the projects landing screen (project context grounding).
 * Lists the owner's projects (useProjects, §15.1), with create/edit/delete and a
 * route into a project's bits detail. Owns only UI state - whether the form is
 * open and which project it is editing (§15.2); all server data is React Query
 * (§15.1). No fetch or business logic here (§14.1); errors surface via the hooks'
 * toast (§16.3) and an inline error state. Other pages are not imported (§12.4).
 * Typed, no any (§17.2). Mirrors Dashboard.
 */
import { useState } from "react";
import { ProjectForm } from "../components/projects/ProjectForm";
import { ProjectList } from "../components/projects/ProjectList";
import { Modal } from "../components/ui/Modal";
import { ThinkingLoader } from "../components/ui/ThinkingLoader";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from "../hooks/queries/useProjectQueries";
import type { Project } from "../types/project";

interface ProjectsManagerProps {
  /** Open a project's bits detail. */
  onOpenProject: (projectId: number) => void;
  /** Return to the dashboard. */
  onExit: () => void;
}

/** Which form, if any, is open. UI state only (§15.2). */
type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; project: Project };

export function ProjectsManager({ onOpenProject, onExit }: ProjectsManagerProps) {
  const [form, setForm] = useState<FormState>({ mode: "closed" });

  const { data: projects, isLoading, error } = useProjects();
  const create = useCreateProject();
  const editingId = form.mode === "edit" ? form.project.id : null;
  const update = useUpdateProject(editingId);
  const remove = useDeleteProject();

  const handleCreate = (values: { name: string; description: string | null }): void => {
    create.mutate(values, { onSuccess: () => setForm({ mode: "closed" }) });
  };

  const handleUpdate = (values: { name: string; description: string | null }): void => {
    update.mutate(values, { onSuccess: () => setForm({ mode: "closed" }) });
  };

  const handleDelete = (project: Project): void => {
    remove.mutate(project.id);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Projects</p>
          <h1 className="font-display text-lg font-semibold text-ink">Your projects</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={onExit}>
            ← Dashboard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setForm({ mode: "create" })}
          >
            New project
          </button>
        </div>
      </header>

      {isLoading && <ThinkingLoader subtitle="Loading your projects" />}
      {error && (
        <p className="text-sm text-muted">Could not load your projects. Try again.</p>
      )}

      {projects && projects.length === 0 && (
        <p className="text-sm text-muted">No projects yet. Create one with “New project”.</p>
      )}

      {projects && projects.length > 0 && (
        <ProjectList
          projects={projects}
          isDeleting={remove.isPending}
          onOpen={(project) => onOpenProject(project.id)}
          onEdit={(project) => setForm({ mode: "edit", project })}
          onDelete={handleDelete}
        />
      )}

      {form.mode !== "closed" && (
        <Modal
          title={form.mode === "edit" ? "Edit project" : "New project"}
          hint="A project groups the bits that ground an interview — the real facts about your app (its stack, screens, constraints, integrations)."
          busy={create.isPending || update.isPending}
          onClose={() => setForm({ mode: "closed" })}
        >
          {form.mode === "edit" ? (
            <ProjectForm
              project={form.project}
              isSaving={update.isPending}
              onSubmit={handleUpdate}
              onCancel={() => setForm({ mode: "closed" })}
            />
          ) : (
            <ProjectForm
              isSaving={create.isPending}
              onSubmit={handleCreate}
              onCancel={() => setForm({ mode: "closed" })}
            />
          )}
        </Modal>
      )}
    </main>
  );
}
