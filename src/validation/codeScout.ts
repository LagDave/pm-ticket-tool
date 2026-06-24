/**
 * Validation schemas for the code-scout domain (§11.2). Two kinds live here,
 * like validation/triage.ts:
 *
 *  1. The STRUCTURED-OUTPUT schema the scout constrains the summarization model
 *     to, plus a boundary re-validation of the parsed result. Kept to the
 *     structured-output-safe `zod/v4` subset (no min/max/refine) the SDK's
 *     `zodOutputFormat` targets, so the generation schema and the boundary schema
 *     stay identical. The scout RE-VALIDATES the model output and throws on an
 *     off-schema result (it is never persisted) — orientation findings must be
 *     well-formed.
 *
 *  2. The WIRE schema for the HTTP boundary — the scout request body carrying the
 *     repo reference (provider + repoRef) the session points at (spec T5) —
 *     applied as route middleware before the controller. Uses plain `zod` like
 *     the other route schemas. The session id comes from the shared
 *     sessionIdParamSchema (params).
 *
 * Validation happens at the boundary; once data reaches the controller it is trusted.
 */
import * as zv4 from "zod/v4";
import { z } from "zod";

/** Coarse effort/feasibility tiers (mirror types/codeScout.ts). Source of truth for both surfaces. */
export const EFFORT_HINTS = ["XS", "S", "M", "L", "XL"] as const;
export const FEASIBILITY_HINTS = ["clear", "likely", "uncertain"] as const;
/** The source-agnostic provider set (mirror CodeContextProviderId). */
export const SCOUT_PROVIDERS = ["github", "azure"] as const;

/** Max length of the free-text repo reference. Named, not magic (§4.2). */
const REPO_REF_MAX_LENGTH = 200;

/* ------------------------------------------------------------------------- *
 * 1. Structured-output schema (model-facing) + boundary re-validation
 * ------------------------------------------------------------------------- */

/** One relevant area the model returns (no refine — zodOutputFormat targets a plain object). */
const relevantAreaOutputSchema = zv4.object({
  area: zv4.string(),
  whatExists: zv4.string(),
  roughSize: zv4.enum(EFFORT_HINTS),
  whatItTouches: zv4.array(zv4.string()),
  feasibility: zv4.enum(FEASIBILITY_HINTS),
  paths: zv4.array(zv4.string()),
});

/**
 * The shape the model returns for the scout summary. `verifyWithEngineering` is
 * intentionally NOT part of the model output — the service stamps it true
 * structurally (spec Risk: the framing is not the model's choice), so the model
 * only produces the summary + the coarse areas.
 */
export const scoutFindingsOutputSchema = zv4.object({
  summary: zv4.string(),
  relevantAreas: zv4.array(relevantAreaOutputSchema),
});

/** Boundary re-validation schema: the same shape. A parse failure is fatal (the scout throws). */
export const scoutFindingsSchema = scoutFindingsOutputSchema;

export type ScoutFindingsParsed = zv4.infer<typeof scoutFindingsSchema>;

/* ------------------------------------------------------------------------- *
 * 2. Wire schema (HTTP boundary, applied as route middleware)
 * ------------------------------------------------------------------------- */

/**
 * The scout request body (spec T5): the repo reference the session points at.
 * `provider` selects the CodeContextProvider; `repoRef` is the provider-native
 * identifier (for GitHub: `owner/name`). A missing or malformed reference is
 * rejected at the boundary with the error envelope (§8.1, §11.2). `repoRef` is
 * trimmed and bounded; emptiness is rejected.
 */
export const scoutRequestSchema = z.object({
  provider: z.enum(SCOUT_PROVIDERS),
  repoRef: z
    .string()
    .trim()
    .min(1, "repoRef is required (e.g. owner/name for GitHub).")
    .max(REPO_REF_MAX_LENGTH, "repoRef is too long."),
});

export type ScoutRequestBody = z.infer<typeof scoutRequestSchema>;
