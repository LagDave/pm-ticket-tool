/**
 * ProjectDetail - a project's bits manager (project context grounding). Loads
 * the project + its bits (useProject, §15.1), lists the bits grouped by kind,
 * and supports add / edit / delete of a bit plus the generate-prompt → import →
 * reconcile-resolve flow (spec T11). Owns only UI state - the add form and which
 * overlay is open (§15.2); all server data is React Query (§15.1). No fetch or
 * business logic here (§14.1); errors surface via the hooks' toast (§16.3) and
 * an inline error state. Other pages are not imported (§12.4). Typed, no any
 * (§17.2).
 */
import { useMemo, useState } from "react";
import { BitForm } from "../components/bits/BitForm";
import { BitListRow } from "../components/bits/BitListRow";
import { BitsToolbar } from "../components/bits/BitsToolbar";
import { GeneratePromptPopup } from "../components/bits/GeneratePromptPopup";
import { ImportDialog } from "../components/bits/ImportDialog";
import { ReconcileResolve } from "../components/bits/ReconcileResolve";
import { Modal } from "../components/ui/Modal";
import { ThinkingLoader } from "../components/ui/ThinkingLoader";
import {
  useCreateBit,
  useDeleteBit,
  useProject,
  useUpdateBit,
} from "../hooks/queries/useProjectQueries";
import { BIT_KINDS, BIT_KIND_LABEL } from "../types/project";
import type {
  BitKind,
  CandidateBit,
  ProjectBit,
  ReconciliationPlan,
} from "../types/project";

interface ProjectDetailProps {
  projectId: number;
  /** Return to the projects manager. */
  onBack: () => void;
}

/** Which bits overlay is open: none, the prompt popup, the import dialog, or the resolve view. */
type Overlay = "none" | "prompt" | "import" | "resolve";

/** The active reconciliation plan being resolved, plus the candidates it came from. */
interface ActivePlan {
  plan: ReconciliationPlan;
  candidates: CandidateBit[];
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
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);

  const { data, isLoading, error } = useProject(projectId);
  const create = useCreateBit(projectId);
  const update = useUpdateBit(projectId);
  const remove = useDeleteBit(projectId);

  const groups = useMemo(() => groupByKind(data?.bits ?? []), [data?.bits]);

  const handleAdd = (values: { kind: BitKind; bit_key: string; summary: string }): void => {
    create.mutate(values, { onSuccess: () => setIsAdding(false) });
  };

  // An additive import produced a plan — keep it and switch to the resolve view.
  const handlePlan = (plan: ReconciliationPlan, candidates: CandidateBit[]): void => {
    setActivePlan({ plan, candidates });
    setOverlay("resolve");
  };

  // Resolve finished (applied or cancelled) — clear it and return to the list;
  // React Query invalidation refreshes the bits.
  const handleResolveDone = (): void => {
    setActivePlan(null);
    setOverlay("none");
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Project</p>
          <h1 className="font-display text-lg font-semibold text-ink">
            {data?.project.name ?? "Project"}
          </h1>
        </div>
        <BitsToolbar
          isAdding={isAdding}
          onGeneratePrompt={() => setOverlay("prompt")}
          onImport={() => setOverlay("import")}
          onAdd={() => setIsAdding(true)}
          onBack={onBack}
        />
      </header>

      {data?.project.description && (
        <blockquote className="surface-2 mb-5 border-l-2 border-accent px-4 py-3 text-sm text-muted">
          {data.project.description}
        </blockquote>
      )}

      {/* The resolve view takes over the main area so the PM focuses on one task (R2). */}
      {overlay === "resolve" && activePlan ? (
        <ReconcileResolve
          projectId={projectId}
          candidates={activePlan.candidates}
          plan={activePlan.plan}
          onDone={handleResolveDone}
        />
      ) : (
        <>
          {isLoading && <ThinkingLoader subtitle="Loading project bits" />}
          {error && <p className="text-sm text-muted">Could not load this project. Try again.</p>}

          {data && groups.length === 0 && (
            <p className="text-sm text-muted">No bits yet. Add one above, or import from your repo.</p>
          )}

          {data &&
            groups.map((group) => (
              <section key={group.kind} className="mb-6">
                <h2 className="eyebrow mb-2">{BIT_KIND_LABEL[group.kind]}</h2>
                <ul className="flex flex-col gap-2">
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
        </>
      )}

      {isAdding && (
        <Modal
          title="Add a bit"
          hint="A typed fact about the app. Settled kinds (constraint, tech stack, inventory) can later suppress a question the interview would otherwise ask."
          busy={create.isPending}
          onClose={() => setIsAdding(false)}
        >
          <BitForm
            isSaving={create.isPending}
            onSubmit={handleAdd}
            onCancel={() => setIsAdding(false)}
          />
        </Modal>
      )}

      {overlay === "prompt" && (
        <GeneratePromptPopup projectId={projectId} onClose={() => setOverlay("none")} />
      )}
      {overlay === "import" && (
        <ImportDialog
          projectId={projectId}
          onClose={() => setOverlay("none")}
          onPlan={handlePlan}
        />
      )}
    </main>
  );
}
