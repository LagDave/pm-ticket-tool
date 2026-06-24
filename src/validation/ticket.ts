/**
 * Validation schemas for the ticket domain (§11.2). Three kinds live here:
 *
 *  1. The STRUCTURED-OUTPUT schema the generator constrains the model to, plus a
 *     boundary re-validation of the parsed result — off-schema output is rejected,
 *     never persisted (spec Risk: malformed Gherkin/criteria). Like the interview
 *     engine, this uses the `zod/v4` surface the SDK's `zodOutputFormat` targets,
 *     kept to the structured-output-safe subset (no min/max constraints — the SDK
 *     strips them), so the generation schema and the boundary schema stay identical.
 *     The enrichment fields (spec What) are best-effort: only a non-empty story and
 *     at least one criterion are hard-required at the boundary, so a thin model
 *     answer is still a usable ticket (spec Risk: larger model output).
 *
 *  2. The WIRE schemas for the HTTP boundary — update (inline edit), add-comment,
 *     finalize — applied as route middleware before the controller (validation/
 *     convention). These use plain `zod` like the other route schemas.
 *
 *  3. The public share-token param schema for the read-only shared-ticket route
 *     (spec What). A URL-safe capability token, validated at the boundary (§11.2).
 *
 * Validation happens at the boundary; once data reaches the controller it is trusted.
 */
import * as zv4 from "zod/v4";
import { z } from "zod";

/** The complexity-tier enum — a TIER, never hours (spec Constraints). Shared by both surfaces. */
export const EFFORT_TIERS = ["XS", "S", "M", "L", "XL"] as const;

/** The priority-tier enum — a coarse impact TIER, never a number (spec What). Shared by both surfaces. */
export const PRIORITY_TIERS = ["high", "medium", "low"] as const;

/* ------------------------------------------------------------------------- *
 * 1. Structured-output schema (model-facing) + boundary re-validation
 * ------------------------------------------------------------------------- */

/** A single Given/When/Then acceptance-criterion block. */
export const acceptanceCriterionOutputSchema = zv4.object({
  given: zv4.string(),
  when: zv4.string(),
  then: zv4.string(),
});

/** A single Key Decision the generator surfaces from the recorded decisions (spec What). */
export const keyDecisionOutputSchema = zv4.object({
  label: zv4.string(),
  detail: zv4.string(),
});

/** A single Codebase Grounding note, derived from scout findings (spec What). */
export const codebaseGroundingOutputSchema = zv4.object({
  area: zv4.string(),
  note: zv4.string(),
});

/**
 * The shape the model returns for structured output (no refine — zodOutputFormat
 * targets a plain object schema). `effort`/`priority` are constrained to their tier
 * enums so the model can never emit hours or a numeric priority (spec Constraints,
 * spec What). The enrichment arrays may be empty; the boundary schema (below) only
 * hard-requires the core story + criteria.
 */
export const generatedTicketOutputSchema = zv4.object({
  user_story: zv4.string(),
  acceptance_criteria: zv4.array(acceptanceCriterionOutputSchema),
  effort: zv4.enum(EFFORT_TIERS),
  context_summary: zv4.string(),
  priority: zv4.enum(PRIORITY_TIERS),
  problem_background: zv4.string(),
  key_decisions: zv4.array(keyDecisionOutputSchema),
  open_questions: zv4.array(zv4.string()),
  success_metrics: zv4.array(zv4.string()),
  dependencies: zv4.array(zv4.string()),
  codebase_grounding: zv4.array(codebaseGroundingOutputSchema),
});

/**
 * The boundary re-validation schema: the same shape, plus the rule that a usable
 * ticket has at least one acceptance criterion and a non-empty story. An empty
 * or off-shape result is rejected here and never written (spec Risk). The
 * enrichment fields stay best-effort — they are NOT gated, so a sparse but valid
 * core ticket still passes (spec Risk: larger model output).
 */
export const generatedTicketSchema = generatedTicketOutputSchema
  .refine((t) => t.user_story.trim().length > 0, {
    message: "user_story must not be empty.",
    path: ["user_story"],
  })
  .refine((t) => t.acceptance_criteria.length > 0, {
    message: "A ticket must have at least one acceptance criterion.",
    path: ["acceptance_criteria"],
  });

export type GeneratedTicketParsed = zv4.infer<typeof generatedTicketSchema>;

/* ------------------------------------------------------------------------- *
 * 2. Wire schemas (HTTP boundary, applied as route middleware)
 * ------------------------------------------------------------------------- */

/** Bounds for editable free-text fields. Named, not magic (§4.2). */
const STORY_MAX_LENGTH = 4_000;
const CRITERION_FIELD_MAX_LENGTH = 1_000;
const CONTEXT_MAX_LENGTH = 8_000;
const COMMENT_MAX_LENGTH = 4_000;

/** Share-token length bounds — base64url of 32 bytes is 43 chars; allow slack. Named, not magic (§4.2). */
const SHARE_TOKEN_MIN_LENGTH = 20;
const SHARE_TOKEN_MAX_LENGTH = 100;

/** Route param schema for :ticketId — a positive integer id. */
export const ticketIdParamSchema = z.object({
  ticketId: z
    .coerce.number()
    .int()
    .positive("ticket id must be a positive integer."),
});

export type TicketIdParam = z.infer<typeof ticketIdParamSchema>;

/**
 * Route param schema for :token — the public share link's capability token (spec
 * What). URL-safe base64url only; bounded length. Validated at the boundary so a
 * malformed token is a clean 400, never a DB lookup with junk (§11.2).
 */
export const shareTokenParamSchema = z.object({
  token: z
    .string()
    .min(SHARE_TOKEN_MIN_LENGTH)
    .max(SHARE_TOKEN_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid share token."),
});

export type ShareTokenParam = z.infer<typeof shareTokenParamSchema>;

/** A Given/When/Then block on the wire (edit payload). */
const acceptanceCriterionWireSchema = z.object({
  given: z.string().trim().min(1).max(CRITERION_FIELD_MAX_LENGTH),
  when: z.string().trim().min(1).max(CRITERION_FIELD_MAX_LENGTH),
  then: z.string().trim().min(1).max(CRITERION_FIELD_MAX_LENGTH),
});

/**
 * Inline-edit payload (spec T3). Carries the `expectedVersion` the client read,
 * for optimistic concurrency (spec Risk: concurrent edits). At least one editable
 * field must be present, else the request is a no-op and rejected at the boundary.
 * `priority` is editable like `effort` (spec What/Risk); the rich generated fields
 * are display-only in v1 and are not accepted here (spec Out Of Scope).
 */
export const updateTicketSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    userStory: z.string().trim().min(1).max(STORY_MAX_LENGTH).optional(),
    acceptanceCriteria: z.array(acceptanceCriterionWireSchema).min(1).optional(),
    effort: z.enum(EFFORT_TIERS).optional(),
    priority: z.enum(PRIORITY_TIERS).optional(),
    contextSummary: z.string().trim().max(CONTEXT_MAX_LENGTH).optional(),
  })
  .refine(
    (body) =>
      body.userStory !== undefined ||
      body.acceptanceCriteria !== undefined ||
      body.effort !== undefined ||
      body.priority !== undefined ||
      body.contextSummary !== undefined,
    { message: "At least one editable field must be provided." },
  );

export type UpdateTicketBody = z.infer<typeof updateTicketSchema>;

/** Add-comment payload (spec T3). Author is derived server-side, never from the body (§5.5). */
export const addCommentSchema = z.object({
  body: z.string().trim().min(1, "A comment body is required.").max(COMMENT_MAX_LENGTH),
});

export type AddCommentBody = z.infer<typeof addCommentSchema>;

/** Finalize payload (spec T3). Version-guarded like an edit (spec Risk). */
export const finalizeTicketSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export type FinalizeTicketBody = z.infer<typeof finalizeTicketSchema>;
