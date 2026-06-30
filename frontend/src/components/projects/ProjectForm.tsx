/**
 * ProjectForm - the create/edit form for a project (§12.3, §13.3). A component
 * renders + delegates: it owns only the controlled field state (§15.2) and calls
 * onSubmit with the trimmed values; no fetch, no business logic here (§14.1).
 * Reused for both "new project" (no initial values) and "edit" (seeded values).
 */
import { useState } from "react";
import type { Project } from "../../types/project";

interface ProjectFormProps {
  /** When editing, the project to seed the fields from; omitted for a new project. */
  project?: Project;
  /** True while the create/update mutation is in flight, to disable the controls. */
  isSaving: boolean;
  /** Submit the trimmed name + description (null when blank). */
  onSubmit: (values: { name: string; description: string | null }) => void;
  /** Cancel and close the form. */
  onCancel: () => void;
}

export function ProjectForm({ project, isSaving, onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSaving;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    const trimmedDescription = description.trim();
    onSubmit({
      name: trimmedName,
      description: trimmedDescription.length > 0 ? trimmedDescription : null,
    });
  };

  return (
    <form className="bit-form" onSubmit={handleSubmit}>
      <label className="bit-field-label" htmlFor="project-name">
        Project name
      </label>
      <input
        id="project-name"
        className="request-input"
        type="text"
        placeholder="e.g. PuzzleHR Web App"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={isSaving}
      />
      <textarea
        id="project-description"
        className="request-input project-description-input"
        rows={3}
        placeholder="Optional: a one-line description of what this app is."
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        disabled={isSaving}
      />
      <div className="step-actions">
        <button type="submit" className="primary-button" disabled={!canSubmit}>
          {isSaving ? "Saving…" : project ? "Save project" : "Create project"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
