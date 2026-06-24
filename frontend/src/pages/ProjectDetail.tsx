/**
 * ProjectDetail - a project's bits manager (project context grounding). Loads
 * the project + its bits (useProject, §15.1), lists the bits grouped by kind,
 * and supports add / edit / delete of a bit. Owns only UI state - whether the
 * add form is open (§15.2); all server data is React Query (§15.1). No fetch or
 * business logic here (§14.1); errors surface via the hooks' toast (§16.3) and
 * an inline error state. Other pages are not imported (§12.4). Typed, no any
 * (§17.2). The import / generate-prompt / reconcile UI is out of scope here (T11).
 */
import { useMemo, useState } from "react";
import { BitForm } from "../components/bits/BitForm";
import { BitListRow } from "../components/bits/BitListRow";
import { ThinkingLoader } from "../components/ui/ThinkingLoader";
import {
  useCreateBit,
  useDeleteBit,
  useProject,
  useUpdateBit,
} from "../hooks/queries/useProjectQueries";
import { BIT_KINDS, BIT_KIND_LABEL } from "../types/project";
import type { BitKind, ProjectBit } from "../types/project";

interface ProjectDetailProps {
  projectId: number;
  /** Return to the projects manager. */
  onBack: () => void;
}

/** Group a flat bit list into the fixed kind order, dropping empty kinds. */
function groupByKind(
  bits: ProjectBit[],
): ReadonlyArray<{ kind: BitKind; bits: ProjectBit[] }> {
  return BIT_KINDS.map((kind) => ({
    kind,
    bits: bits.filter((bit) => bit.kind === kind),
  })).filter((group) => group.bits.length > 0);
}

export function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const [isAdding, setIsAdding] = useState(false);

  const { data, isLoading, error } = useProject(projectId);
  const create = useCreateBit(projectId);
  const update = useUpdateBit(projectId);
  const remove = useDeleteBit(projectId);

  const groups = useMemo(() => groupByKind(data?.bits ?? []), [data?.bits]);

  const handleAdd = (values: { kind: BitKind; bit_key: string; summary: string }): void => {
    create.mutate(values, { onSuccess: () => setIsAdding(false) });
  };

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="wizard-brand">
          <img className="wizard-logo" src="/logo.webp" alt="" aria-hidden width={32} height={32} />
          <h1 className="wizard-title">{data?.project.name ?? "Project"}</h1>
        </div>
        <div className="dashboard-header-actions">
          {!isAdding && (
            <button
              type="button"
              className="primary-button"
              onClick={() => setIsAdding(true)}
            >
              Add bit
            </button>
          )}
          <button type="button" className="link-button" onClick={onBack}>
            ← Projects
          </button>
        </div>
      </header>

      {data?.project.description && (
        <blockquote className="request-echo">{data.project.description}</blockquote>
      )}

      {isAdding && (
        <div className="step-panel">
          <p className="field-label">Add a bit</p>
          <p className="field-hint">
            A typed fact about the app. Settled kinds (constraint, tech stack,
            inventory) can later suppress a question the interview would otherwise ask.
          </p>
          <BitForm
            isSaving={create.isPending}
            onSubmit={handleAdd}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      {isLoading && <ThinkingLoader subtitle="Loading project bits" />}
      {error && <p className="field-hint">Could not load this project. Try again.</p>}

      {data && groups.length === 0 && (
        <p className="field-hint">No bits yet. Add one above.</p>
      )}

      {data &&
        groups.map((group) => (
          <section key={group.kind} className="bit-group">
            <h2 className="bit-group-heading">{BIT_KIND_LABEL[group.kind]}</h2>
            <ul className="bit-list">
              {group.bits.map((bit) => (
                <BitListRow
                  key={bit.id}
                  bit={bit}
                  isSaving={update.isPending}
                  isDeleting={remove.isPending}
                  onSave={(values) => update.mutate({ bitId: bit.id, input: values })}
                  onDelete={() => remove.mutate(bit.id)}
                />
              ))}
            </ul>
          </section>
        ))}
    </main>
  );
}
