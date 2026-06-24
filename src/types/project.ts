/**
 * Shared backend domain types for Project Context & Bits — the human-curated
 * grounding substrate that replaces the code scout. Rows mirror the project /
 * project_bits migration columns; every shape is structured, never `any` (§4.5).
 * Mirrors types/interview.ts.
 */

/** Bit kinds — mirror the project_bits_kind_check constraint. Source of truth. */
export type BitKind =
  | "feature"
  | "constraint"
  | "integration"
  | "tech_stack"
  | "inventory";

export type BitStatus = "active" | "superseded";

export type BitSource = "manual" | "imported" | "merged";

/**
 * The "settled" kinds — hard facts the interview may treat as already decided and
 * SUPPRESS the matching question (spec R3), rather than merely grounding an option.
 * The remaining kinds (feature, integration) only flavor options. Named once here
 * so the engine, the agent prompt, and tests share one source of truth (§4.2).
 */
export const SETTLED_BIT_KINDS: readonly BitKind[] = [
  "constraint",
  "tech_stack",
  "inventory",
];

/** A row of projects. Owner-scoped (§11.7). */
export interface IProject {
  id: number;
  owner_user_id: number;
  organization_id: number | null;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

/** A row of project_bits. `bit_key` is a cosmetic label; dedup is semantic. */
export interface IProjectBit {
  id: number;
  project_id: number;
  kind: BitKind;
  bit_key: string;
  summary: string;
  status: BitStatus;
  source: BitSource;
  source_ticket_id: number | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A candidate bit awaiting reconciliation — what an import row, a manual add, or a
 * merge-on-complete proposal carries before it becomes an IProjectBit. No id yet;
 * status/source are assigned on apply.
 */
export interface CandidateBit {
  kind: BitKind;
  bit_key: string;
  summary: string;
}

/**
 * What the reconciliation agent decides for one incoming candidate against the
 * project's existing active bits (spec R2). `insert` is auto-appliable; every
 * other action carries a target/related bit and a reason for the human resolve
 * step — the agent proposes, the human disposes (never auto-delete).
 */
export type ReconciliationActionType =
  | "insert"
  | "update"
  | "skip_duplicate"
  | "conflict"
  | "similar";

export interface ReconciliationAction {
  /** Index into the incoming candidate array this action is for. */
  incomingIndex: number;
  action: ReconciliationActionType;
  /** The existing bit this updates/duplicates/conflicts with (when applicable). */
  targetBitId?: number | null;
  /** For `similar`: other related existing bit ids. */
  relatedBitIds?: number[];
  /** For `update`: the merged summary the agent proposes (the human may edit). */
  mergedSummary?: string | null;
  /** Short auditable reason for the action. */
  reason: string;
}

/** The agent's full proposal for a batch of candidates (re-validated at the boundary, §11.2). */
export interface ReconciliationPlan {
  actions: ReconciliationAction[];
}

/**
 * A human-confirmed resolution applied to one action (the resolve screen sends
 * these back). `force` overrides a conflict/similar flag. The chosen summary may
 * differ from the agent's proposal (the PM edited it).
 */
export type ResolutionChoice = "insert" | "merge" | "keep_both" | "skip" | "force";

export interface ResolvedAction {
  incomingIndex: number;
  choice: ResolutionChoice;
  targetBitId?: number | null;
  summary?: string | null;
}

/**
 * The grounding block the interview/ticket agents receive in place of the old
 * ScoutFindings: the project's active bits, already loaded by the service. It is
 * rendered into the cached system prefix (spec R4). Absent (undefined) routes the
 * agents to the unchanged ungrounded path.
 */
export interface ProjectGrounding {
  projectName: string;
  bits: IProjectBit[];
}
