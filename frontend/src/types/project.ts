/**
 * Shared frontend domain types for the project + bits API (spec — project
 * context grounding). Mirrors the backend row shapes; snake_case for fields that
 * come straight off a DB row (the API echoes the row), camelCase for request
 * inputs. No `any` (§17.2).
 */

/**
 * The five bit kinds (spec bit taxonomy). The first three are "settled" kinds
 * that can suppress a question; `feature`/`integration` only flavor options.
 * Mirrors the backend BitKind.
 */
export type BitKind =
  | "feature"
  | "constraint"
  | "integration"
  | "tech_stack"
  | "inventory";

/** A bit's lifecycle status. `superseded` rows are kept for the audit trail. */
export type BitStatus = "active" | "superseded";

/** How a bit entered the project: hand-entered, bulk-imported, or merged from a ticket. */
export type BitSource = "manual" | "imported" | "merged";

/** A project as returned by the API. */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** A project bit (typed key→summary row) as returned by the API. */
export interface ProjectBit {
  id: number;
  project_id: number;
  kind: BitKind;
  bit_key: string;
  summary: string;
  status: BitStatus;
  source: BitSource;
  created_at: string;
  updated_at: string;
}

/** The read model GET /projects/:id returns: the project plus its bits. */
export interface ProjectWithBits {
  project: Project;
  bits: ProjectBit[];
}

/** POST /projects request body. */
export interface CreateProjectInput {
  name: string;
  description?: string | null;
}

/** PATCH /projects/:id request body. At least one field is set. */
export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

/** POST /projects/:id/bits request body (a single manual bit). */
export interface CreateBitInput {
  kind: BitKind;
  bit_key: string;
  summary: string;
}

/** PATCH /projects/:id/bits/:bitId request body. At least one field is set. */
export interface UpdateBitInput {
  kind?: BitKind;
  bit_key?: string;
  summary?: string;
}

/* ---------------------------------------------------------------------------
 * Reconciliation + import (spec T11). A candidate bit is an *incoming* fact
 * (from an import file or a single add) the reconciliation agent diffs against
 * the project's active bits; it has no id/status/source yet. The agent returns
 * a ReconciliationPlan the PM resolves before anything is written. Mirrors the
 * backend contract (POST /bits/reconcile, /apply, /import). No `any` (§17.2).
 * ------------------------------------------------------------------------- */

/** An incoming bit proposed for the project, before reconciliation. */
export interface CandidateBit {
  kind: BitKind;
  bit_key: string;
  summary: string;
}

/**
 * The reconciliation agent's verdict for one incoming candidate:
 * - `insert` — new fact, auto-applies;
 * - `update` — supersede the target bit with a merged summary;
 * - `skip_duplicate` — already covered, no-op;
 * - `conflict` — contradicts an existing bit, needs a human call;
 * - `similar` — overlaps an existing bit, may be merged or kept separate.
 */
export type ReconciliationActionKind =
  | "insert"
  | "update"
  | "skip_duplicate"
  | "conflict"
  | "similar";

/** One action in a plan, tied to its incoming candidate by index. */
export interface ReconciliationAction {
  /** Index into the candidates array this action is about. */
  incomingIndex: number;
  action: ReconciliationActionKind;
  /** The existing bit this action updates/conflicts with, when relevant. */
  targetBitId?: number | null;
  /** Other existing bits the agent saw as related (for `similar`). */
  relatedBitIds?: number[];
  /** The agent's proposed merged summary (for `update`/`similar`). */
  mergedSummary?: string | null;
  /** Plain-language why, shown on the resolve screen so conflicts are scannable. */
  reason: string;
}

/** What the reconcile/import endpoints return: one action per incoming candidate. */
export interface ReconciliationPlan {
  actions: ReconciliationAction[];
}

/** The PM's per-candidate decision on the resolve screen. */
export type ResolutionChoice = "insert" | "merge" | "keep_both" | "skip" | "force";

/** One resolved decision posted back to /apply, tied to its candidate by index. */
export interface Resolution {
  incomingIndex: number;
  choice: ResolutionChoice;
  /** The existing bit a merge/force targets, when relevant. */
  targetBitId?: number | null;
  /** The final (possibly PM-edited) summary to persist. */
  summary?: string | null;
}

/** POST /projects/:id/bits/reconcile request body. */
export interface ReconcileInput {
  candidates: CandidateBit[];
}

/** POST /projects/:id/bits/apply request body. */
export interface ApplyResolutionsInput {
  candidates: CandidateBit[];
  resolutions: Resolution[];
}

/** POST /projects/:id/bits/import request body. `force` replaces existing bits. */
export interface ImportBitsInput {
  bits: CandidateBit[];
  force?: boolean;
}

/**
 * What POST /projects/:id/bits/import returns — a tagged union:
 * - `reconcile` — additive import, the server diffed the bits into a plan the PM
 *   must resolve before anything is written;
 * - `applied` — a forced import, the server already replaced the bits and hands
 *   back the resulting rows, so the caller skips the resolve step.
 */
export type ImportResult =
  | { mode: "reconcile"; plan: ReconciliationPlan }
  | { mode: "applied"; bits: ProjectBit[] };

/** GET /projects/:id/bit-prompt response. */
export interface BitPrompt {
  prompt: string;
}

/** The selectable bit kinds, for the kind <select> control. */
export const BIT_KINDS: readonly BitKind[] = [
  "feature",
  "constraint",
  "integration",
  "tech_stack",
  "inventory",
];

/** Human-readable labels for each kind (the kind heading + select option). */
export const BIT_KIND_LABEL: Record<BitKind, string> = {
  feature: "Feature",
  constraint: "Constraint",
  integration: "Integration",
  tech_stack: "Tech stack",
  inventory: "Inventory",
};

/** Human-readable label for each reconciliation action (resolve-screen heading). */
export const RECONCILIATION_ACTION_LABEL: Record<ReconciliationActionKind, string> = {
  conflict: "Conflicts",
  similar: "Similar — review",
  update: "Updates an existing bit",
  insert: "New bits",
  skip_duplicate: "Duplicates — will skip",
};

/**
 * The order action groups render in on the resolve screen. Conflicts and
 * similars come first so they are cheap to scan and never rubber-stamped (R2).
 */
export const RECONCILIATION_ACTION_ORDER: readonly ReconciliationActionKind[] = [
  "conflict",
  "similar",
  "update",
  "insert",
  "skip_duplicate",
];
