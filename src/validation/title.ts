/**
 * Validation schemas for the title agent (§11.2). The title generator makes a
 * cheap structured-output call and the result is re-validated at the boundary,
 * exactly like validation/triage.ts:
 *
 *  1. The STRUCTURED-OUTPUT schema the model is constrained to — a single
 *     `title` string. Uses the `zod/v4` surface the SDK's `zodOutputFormat`
 *     targets, kept to the structured-output-safe subset (no min/max — the SDK
 *     strips them), so the generation schema and the boundary schema match.
 *  2. The BOUNDARY re-validation — the same shape. A title is never a hard gate:
 *     the service treats an unusable/off-schema result as "no title" (null)
 *     rather than throwing, so a bad model response can never fail a session
 *     create or a ticket finalize.
 *
 * Validation happens at the boundary; once data reaches the service it is trusted.
 */
import * as zv4 from "zod/v4";

/**
 * Upper bound on a generated title, enforced after sanitizing. Named, not magic
 * (§4.2). ~8 words at a generous average word length plus spaces — a hard
 * character backstop so a runaway model response can never persist a paragraph
 * as a "title". The word cap (TITLE_MAX_WORDS) is the primary limit; this is the
 * belt-and-braces character ceiling.
 */
export const TITLE_MAX_LENGTH = 80;

/** Target word cap for a concise title (~8 words). Named, not magic (§4.2). */
export const TITLE_MAX_WORDS = 8;

/**
 * The shape the model returns for structured output (no refine — zodOutputFormat
 * targets a plain object schema). A single short title string; the service
 * sanitizes and length-caps it before persisting.
 */
export const generatedTitleOutputSchema = zv4.object({
  title: zv4.string(),
});

/**
 * The boundary re-validation schema: the same shape. A parse failure here is NOT
 * fatal — the service treats an unparsable/off-schema result as "no title"
 * (null), so a bad title response can never fail the create/finalize it rides on.
 */
export const generatedTitleSchema = generatedTitleOutputSchema;

export type GeneratedTitleParsed = zv4.infer<typeof generatedTitleSchema>;
