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
import { createPortal } from "react-dom";
import { ThinkingLoader } from "../ui/ThinkingLoader";
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // The native input lives inside the dropzone <label>, so a click anywhere on
  // the box opens the picker without a programmatic .click() (which the browser
  // can ignore).
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
    if (file) {
      setFileName(file.name);
      readFile(file);
    }
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    if (importBits.isPending) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setFileName(file.name);
      readFile(file);
    }
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Import bits"
    >
      <div className="surface my-auto w-full max-w-2xl p-5">
        <header className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">Import bits</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={importBits.isPending}>
            Close
          </button>
        </header>
        {importBits.isPending ? (
          <div className="py-6">
            <ThinkingLoader
              subtitle={
                force
                  ? "Replacing your project's bits…"
                  : "Reconciling against your existing bits — this runs the AI, so it can take up to a minute. Don't close this."
              }
            />
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              Paste the JSON a Claude Code session wrote for this repo, or choose the
              file it saved.
            </p>

            <label className="mb-3 flex flex-col gap-1.5">
              <span className="eyebrow">Bits JSON</span>
              <textarea
                className="field font-mono text-xs"
                rows={9}
                placeholder='{ "bits": [ { "kind": "feature", "bit_key": "auth", "summary": "…" } ] }'
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>

            <div className="mb-3 flex flex-col gap-1.5">
              <span className="eyebrow">…or upload a file</span>
              {/* A <label> wrapping the input opens the picker natively (no JS
                  click, which can be blocked); it is also a drag-and-drop target. */}
              <label
                className={
                  "surface-2 flex cursor-pointer flex-col items-center gap-1 rounded-card border-dashed px-4 py-6 text-center transition-colors " +
                  (isDragging ? "border-accent bg-surface-2" : "")
                }
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  className="hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFile}
                />
                <span className="text-sm text-ink">
                  {fileName ?? "Drag a .json file here, or click to browse"}
                </span>
                {fileName && (
                  <span className="text-xs text-muted">Click to choose a different file</span>
                )}
              </label>
            </div>

            <label className="mb-2 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              <span>Replace existing bits (force)</span>
            </label>

            {force && (
              <p className="mb-2 text-sm text-danger">
                Force replaces every existing bit on this project — no reconciliation step.
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleImport}
                disabled={text.trim().length === 0}
              >
                {force ? "Replace bits" : "Reconcile import"}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
