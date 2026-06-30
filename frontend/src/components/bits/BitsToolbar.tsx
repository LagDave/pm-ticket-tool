/**
 * BitsToolbar - the project-detail header actions for the bits manager (§12.3,
 * §13.3): generate the repo prompt, open the import dialog, add a manual bit, and
 * go back. Presentational only — it owns no state and runs no fetch or business
 * logic (§14.1); it just calls the handlers the page passes. Keeps ProjectDetail
 * lean (§13.2). Typed, no any (§17.2).
 */
interface BitsToolbarProps {
  /** True while the inline add form is open, so the Add bit button hides. */
  isAdding: boolean;
  onGeneratePrompt: () => void;
  onImport: () => void;
  onAdd: () => void;
  onBack: () => void;
}

export function BitsToolbar({
  isAdding,
  onGeneratePrompt,
  onImport,
  onAdd,
  onBack,
}: BitsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn" onClick={onGeneratePrompt}>
        Generate prompt
      </button>
      <button type="button" className="btn" onClick={onImport}>
        Import bits
      </button>
      {!isAdding && (
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          Add bit
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Projects
      </button>
    </div>
  );
}
