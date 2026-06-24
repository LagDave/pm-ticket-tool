/**
 * BitListRow - one bit in the project's bits list, with inline edit + delete
 * (§12.3, §13.3). A component renders + delegates: it owns only whether its own
 * edit form / delete-confirm is open (UI state, §15.2) and calls the handlers the
 * page passes; no fetch, no business logic here (§14.1). The source badge keeps
 * the audit trail visible (manual / imported / merged).
 */
import { useState } from "react";
import { BitForm } from "./BitForm";
import type { BitKind, ProjectBit } from "../../types/project";

interface BitListRowProps {
  bit: ProjectBit;
  /** True while a save is in flight, to disable the edit form. */
  isSaving: boolean;
  /** True while a delete is in flight, to disable the confirm buttons. */
  isDeleting: boolean;
  /** Save an edit to this bit. */
  onSave: (values: { kind: BitKind; bit_key: string; summary: string }) => void;
  /** Permanently delete this bit (after the inline confirm). */
  onDelete: () => void;
}

/** Human-readable labels for the bit source badge. */
const SOURCE_LABEL: Record<ProjectBit["source"], string> = {
  manual: "Manual",
  imported: "Imported",
  merged: "Merged",
};

export function BitListRow({
  bit,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: BitListRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  if (isEditing) {
    return (
      <li className="bit-row bit-row-editing">
        <BitForm
          bit={bit}
          isSaving={isSaving}
          onSubmit={(values) => {
            onSave(values);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="bit-row">
      <div className="bit-row-main">
        <div className="bit-row-head">
          <span className="bit-key">{bit.bit_key}</span>
          <span className="bit-source">{SOURCE_LABEL[bit.source]}</span>
        </div>
        <p className="bit-summary">{bit.summary}</p>
      </div>
      <div className="bit-row-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setIsEditing(true)}
        >
          Edit
        </button>
        {isConfirmingDelete ? (
          <>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                onDelete();
                setIsConfirmingDelete(false);
              }}
              disabled={isDeleting}
            >
              Confirm
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsConfirmingDelete(false)}
              disabled={isDeleting}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="session-delete"
            onClick={() => setIsConfirmingDelete(true)}
            aria-label={`Delete bit: ${bit.bit_key}`}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
