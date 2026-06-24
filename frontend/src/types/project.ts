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
