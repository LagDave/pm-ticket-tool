/**
 * Validation schemas for the triage domain (§11.2). Two kinds live here, like
 * validation/ticket.ts:
 *
 *  1. The STRUCTURED-OUTPUT schema the classifier constrains the model to, plus
 *     a boundary re-validation of the parsed result. The service does NOT throw
 *     on an off-schema result — it defaults to `scoped` (spec Risk: default to
 *     scoped when unsure) — but the schema is the single source of the label set.
 *     Uses the `zod/v4` surface the SDK's `zodOutputFormat` targets, kept to the
 *     structured-output-safe subset (no min/max), so the generation schema and
 *     the boundary schema stay identical.
 *
 *  2. The WIRE schema for the HTTP boundary — the triage request body carrying
 *     the optional `override` flag — applied as route middleware before the
 *     controller (validation/ convention). Uses plain `zod` like the other route
 *     schemas. The session id comes from the shared sessionIdParamSchema (params).
 *
 * Validation happens at the boundary; once data reaches the controller it is trusted.
 */
import * as zv4 from "zod/v4";
import { z } from "zod";

/** The two triage labels (spec What). Shared by both surfaces; the source of truth. */
export const TRIAGE_RESULTS = ["simple", "scoped"] as const;

/* ------------------------------------------------------------------------- *
 * 1. Structured-output schema (model-facing) + boundary re-validation
 * ------------------------------------------------------------------------- */

/**
 * The shape the model returns for structured output (no refine — zodOutputFormat
 * targets a plain object schema). `result` is constrained to the label enum so
 * the model can never emit an out-of-set label; `reason` is a short rationale
 * kept for logging.
 */
export const triageClassificationOutputSchema = zv4.object({
  result: zv4.enum(TRIAGE_RESULTS),
  reason: zv4.string(),
});

/**
 * The boundary re-validation schema: the same shape. A parse failure here is
 * NOT fatal — the service treats an unparsable/off-schema result as `scoped`
 * (spec Risk: default to scoped when unsure), so a bad model response can never
 * route scoped work to a thin ticket.
 */
export const triageClassificationSchema = triageClassificationOutputSchema;

export type TriageClassificationParsed = zv4.infer<typeof triageClassificationSchema>;

/* ------------------------------------------------------------------------- *
 * 2. Wire schema (HTTP boundary, applied as route middleware)
 * ------------------------------------------------------------------------- */

/**
 * Triage request body (spec T2). `override` forces the full interview regardless
 * of the classifier's label — the classification is never a hard gate (spec
 * Must Not). Defaults to false so a plain triage call just routes on the label.
 */
export const triageRequestSchema = z.object({
  override: z.boolean().optional().default(false),
});

export type TriageRequestBody = z.infer<typeof triageRequestSchema>;
