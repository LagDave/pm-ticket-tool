/**
 * Shared ticket + comment types (spec 3 T4, extended for spec What). Mirror the
 * backend domain shapes: snake_case for fields that come straight off a DB row
 * (the API echoes the row), camelCase for request inputs and the jsonb details
 * payload. No `any` (§17.2).
 */

export type TicketStatus = "draft" | "final";

/** Effort is a complexity TIER, never hours (spec Constraints). */
export type EffortTier = "XS" | "S" | "M" | "L" | "XL";

/** Priority is a coarse impact TIER, never a number (spec What). */
export type TicketPriority = "high" | "medium" | "low";

/** One Given/When/Then acceptance-criterion block. */
export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

/** One settled decision surfaced on the ticket (spec What: Key Decisions). */
export interface KeyDecision {
  label: string;
  detail: string | null;
}

/** One codebase-grounding note from scout findings (spec What: Codebase Grounding). */
export interface CodebaseGroundingItem {
  area: string;
  note: string;
}

/** The rich enrichment payload (tickets.details jsonb). Mirrors the backend TicketDetails. */
export interface TicketDetails {
  problemBackground: string | null;
  keyDecisions: KeyDecision[];
  openQuestions: string[];
  successMetrics: string[];
  dependencies: string[];
  codebaseGrounding: CodebaseGroundingItem[];
}

/** A ticket row as returned by the API. */
export interface Ticket {
  id: number;
  session_id: number;
  user_story: string | null;
  acceptance_criteria: AcceptanceCriterion[] | null;
  effort: EffortTier | null;
  status: TicketStatus;
  version: number;
  rendered_markdown: string | null;
  context_summary: string | null;
  /** Coarse priority tier, or null until generation sets it (spec What). */
  priority: TicketPriority | null;
  /** Rich enrichment payload, or null on legacy/pre-generation rows (spec What). */
  details: TicketDetails | null;
  /** Public capability token; used to build the share link client-side (spec What). */
  share_token: string;
  created_at: string;
  updated_at: string;
}

/**
 * The public, read-only projection the shared-ticket endpoint returns (spec What).
 * Content only: no id, session_id, share_token, or comments (mirrors the backend
 * PublicTicket — the share link leaks nothing internal).
 */
export interface PublicTicket {
  user_story: string | null;
  acceptance_criteria: AcceptanceCriterion[] | null;
  effort: EffortTier | null;
  priority: TicketPriority | null;
  context_summary: string | null;
  details: TicketDetails | null;
  status: TicketStatus;
  version: number;
  rendered_markdown: string | null;
  created_at: string;
}

/** A comment row as returned by the API. */
export interface TicketComment {
  id: number;
  ticket_id: number;
  author_user_id: number;
  body: string;
  created_at: string;
}

/** The read model GET /tickets/:id returns: the ticket plus its comments. */
export interface TicketWithComments {
  ticket: Ticket;
  comments: TicketComment[];
}

/**
 * Inline-edit payload (PATCH /tickets/:id). Carries the version the client read,
 * for optimistic concurrency (spec Risk). At least one editable field must be set.
 * `priority` is editable like `effort` (spec What); the rich details are not.
 */
export interface UpdateTicketInput {
  expectedVersion: number;
  userStory?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  effort?: EffortTier;
  priority?: TicketPriority;
  contextSummary?: string;
}

/** Add-comment payload (POST /tickets/:id/comments). */
export interface AddCommentInput {
  body: string;
}

/** Finalize payload (POST /tickets/:id/finalize), version-guarded. */
export interface FinalizeTicketInput {
  expectedVersion: number;
}

/** The selectable effort tiers, for the edit control. */
export const EFFORT_TIERS: readonly EffortTier[] = ["XS", "S", "M", "L", "XL"];

/** The selectable priority tiers, for the edit control (spec What). */
export const PRIORITY_TIERS: readonly TicketPriority[] = ["high", "medium", "low"];
