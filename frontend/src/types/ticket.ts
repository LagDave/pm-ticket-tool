/**
 * Shared ticket + comment types (spec 3 T4). Mirror the backend domain shapes:
 * snake_case for fields that come straight off a DB row (the API echoes the row),
 * camelCase for request inputs. No `any` (§17.2).
 */

export type TicketStatus = "draft" | "final";

/** Effort is a complexity TIER, never hours (spec Constraints). */
export type EffortTier = "XS" | "S" | "M" | "L" | "XL";

/** One Given/When/Then acceptance-criterion block. */
export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
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
  created_at: string;
  updated_at: string;
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
 */
export interface UpdateTicketInput {
  expectedVersion: number;
  userStory?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  effort?: EffortTier;
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
