/**
 * ImportDialog - paste or upload the JSON a Claude Code session wrote for this
 * project, parse + shape-check it client-side into CandidateBit[], then submit
 * it (spec T11). A modal overlay; a component renders + delegates (§13.2): it
 * owns only the textarea / force-flag UI state (§15.2) and calls useImportBits
 * (§15.1) — no fetch or business logic beyond parsing here (§14.1). Parse and
 * shape errors surface via toast and never crash the page (§16.x). An additive
 * import returns a plan to resolve (onPlan); a forced import is already applied,
 * so it just toasts + closes. Typed, no any (§17.2).
 */
import { useState } from "react";
import { useImportBits } from "../../hooks/queries/useProjectQueries";
import { toast } from "../../lib/toast";
import { BIT_KINDS } from "../../types/project";
import type { BitKind, CandidateBit, ReconciliationPlan } from "../../types/project";

interface ImportDialogProps {
  projectId: number;
  /** Close the dialog and return to the bits list. */
  onClose: () => void;
  /** An additive import produced a plan; hand it + the parsed candidates to the resolve view. */
  onPlan: (plan: ReconciliationPlan, candidates: CandidateBit[]) => void;
}

/** True when the value is a non-null object (and not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the string is one of the known bit kinds. */
function isBitKind(value: unknown): value is BitKind {
  return typeof value === "string" && (BIT_KINDS as readonly string[]).includes(value);
}

/** Narrow one unknown entry to a CandidateBit, or null if it doesn't fit the shape. */
function toCandidate(value: unknown): CandidateBit | null {
  if (!isRecord(value)) return null;
  const { kind, bit_key: bitKey, summary } = value;
  if (!isBitKind(kind)) return null;
  if (typeof bitKey !== "string" || bitKey.trim().length === 0) return null;
  if (typeof summary !== "string" || summary.trim().length === 0) return null;
  return { kind, bit_key: bitKey.trim(), summary: summary.trim() };
}

/**
 * Parse the import text into CandidateBit[]. Accepts either a bare array of bits
 * or a `{ bits: [...] }` envelope (the shape the generate prompt writes). Throws
 * an Error with a plain-language message the caller surfaces via toast.
 */
function parseImport(text: string): CandidateBit[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Paste the JSON or choose a file first.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("That isn't valid JSON. Check the file or pasted text.");
  }

  const rawBits = isRecord(parsed) ? parsed.bits : parsed;
  if (!Array.isArray(rawBits)) {
    throw new Error('Expected an array of bits, or a { "bits": [...] } object.');
  }
  if (rawBits.length === 0) {
    throw new Error("The file has no bits in it.");
  }

  const candidates: CandidateBit[] = [];
  for (let i = 0; i < rawBits.length; i += 1) {
    const candidate = toCandidate(rawBits[i]);
    if (!candidate) {
      throw new Error(
        `Bit #${i + 1} is missing a valid kind, bit_key, or summary. Fix it and try again.`,
      );
    }
    candidates.push(candidate);
  }
  return candidates;
}

export function ImportDialog({ projectId, onClose, onPlan }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [force, setForce] = useState(false);
  const importBits = useImportBits(projectId);

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      // FileReader.result is string here because we read as text.
      setText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      toast.error("Could not read that file. Try pasting the JSON instead.");
    };
    reader.readAsText(file);
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
  };

  const handleImport = (): void => {
    let candidates: CandidateBit[];
    try {
      candidates = parseImport(text);
    } catch (parseError) {
      toast.error(parseError instanceof Error ? parseError.message : "Could not read the import.");
      return;
    }

    importBits.mutate(
      { bits: candidates, force },
      {
        onSuccess: (result) => {
          if (result.mode === "reconcile") {
            onPlan(result.plan, candidates);
          } else {
            // Forced import — the hook already invalidated + toasted; just close.
            onClose();
          }
        },
      },
    );
  };

  return (
    <div className="bit-overlay" role="dialog" aria-modal="true" aria-label="Import bits">
      <div className="bit-overlay-card">
        <header className="bit-overlay-head">
          <h2 className="step-heading">Import bits</h2>
          <button type="button" className="link-button" onClick={onClose} disabled={importBits.isPending}>
            Close
          </button>
        </header>
        <p className="field-hint">
          Paste the JSON a Claude Code session wrote for this repo, or choose the
          file it saved.
        </p>

        <label className="bit-field">
          <span className="bit-field-label">Bits JSON</span>
          <textarea
            className="request-input"
            rows={9}
            placeholder='{ "bits": [ { "kind": "feature", "bit_key": "auth", "summary": "…" } ] }'
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={importBits.isPending}
          />
        </label>

        <div className="bit-import-controls">
          <label className="bit-file-field">
            <span className="bit-field-label">…or choose a file</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              disabled={importBits.isPending}
            />
          </label>

          <label className="bit-force-toggle">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              disabled={importBits.isPending}
            />
            <span>Replace existing bits (force)</span>
          </label>
        </div>

        {force && (
          <p className="field-hint bit-force-warning">
            Force replaces every existing bit on this project — no reconciliation step.
          </p>
        )}

        <div className="step-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleImport}
            disabled={importBits.isPending || text.trim().length === 0}
          >
            {importBits.isPending ? "Importing…" : force ? "Replace bits" : "Reconcile import"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={importBits.isPending}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
