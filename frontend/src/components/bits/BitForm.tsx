/**
 * BitForm - the add/edit form for a single project bit (§12.3, §13.3). A
 * component renders + delegates: it owns only the controlled field state (§15.2)
 * and calls onSubmit with the trimmed values; no fetch, no business logic here
 * (§14.1). Reused for "add bit" (no initial values) and "edit bit" (seeded). The
 * kind <select> is the bit taxonomy; bit_key is a cosmetic label, summary is the
 * fact text.
 */
import { useState } from "react";
import { BIT_KINDS, BIT_KIND_LABEL } from "../../types/project";
import type { BitKind, ProjectBit } from "../../types/project";

interface BitFormProps {
  /** When editing, the bit to seed the fields from; omitted when adding. */
  bit?: ProjectBit;
  /** True while the create/update mutation is in flight, to disable the controls. */
  isSaving: boolean;
  /** Submit the trimmed kind + key + summary. */
  onSubmit: (values: { kind: BitKind; bit_key: string; summary: string }) => void;
  /** Cancel and close the form. */
  onCancel: () => void;
}

export function BitForm({ bit, isSaving, onSubmit, onCancel }: BitFormProps) {
  const [kind, setKind] = useState<BitKind>(bit?.kind ?? "feature");
  const [bitKey, setBitKey] = useState(bit?.bit_key ?? "");
  const [summary, setSummary] = useState(bit?.summary ?? "");

  const trimmedKey = bitKey.trim();
  const trimmedSummary = summary.trim();
  const canSubmit = trimmedKey.length > 0 && trimmedSummary.length > 0 && !isSaving;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ kind, bit_key: trimmedKey, summary: trimmedSummary });
  };

  return (
    <form className="bit-form" onSubmit={handleSubmit}>
      <div className="bit-form-row">
        <label className="bit-field">
          <span className="bit-field-label">Kind</span>
          <select
            className="ticket-effort-select"
            value={kind}
            onChange={(event) => setKind(event.target.value as BitKind)}
            disabled={isSaving}
          >
            {BIT_KINDS.map((option) => (
              <option key={option} value={option}>
                {BIT_KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="bit-field bit-field-grow">
          <span className="bit-field-label">Key</span>
          <input
            className="request-input"
            type="text"
            placeholder="e.g. auth"
            value={bitKey}
            onChange={(event) => setBitKey(event.target.value)}
            disabled={isSaving}
          />
        </label>
      </div>
      <label className="bit-field">
        <span className="bit-field-label">Summary</span>
        <textarea
          className="request-input"
          rows={3}
          placeholder="The fact, in plain language. e.g. Email/password login plus Google SSO."
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          disabled={isSaving}
        />
      </label>
      <div className="step-actions">
        <button type="submit" className="primary-button" disabled={!canSubmit}>
          {isSaving ? "Saving…" : bit ? "Save bit" : "Add bit"}
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
