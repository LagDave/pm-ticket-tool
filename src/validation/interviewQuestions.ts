/**
 * Structured-output schema for a generated question batch (§11.2). The model
 * is constrained to this shape via zodOutputFormat, and the parsed output is
 * re-validated here at the boundary before it is ever persisted — off-schema
 * output is rejected, never written (spec Risk: malformed model output).
 *
 * Uses the `zod/v4` surface (the SDK's `zodOutputFormat` targets a v4 `ZodType`;
 * the project ships zod 3.25+ which exports v4 under this subpath). Kept to the
 * structured-output-safe subset (no min/max length / numeric bounds): the SDK
 * strips unsupported constraints from the schema it sends and validates them
 * client-side, so the generation schema and this boundary schema stay identical.
 * Closed-set `enum` constraints ARE structured-output-safe (the scout uses them
 * in validation/codeScout.ts). The per-batch caps (question count, at most one
 * recommended option per question) are enforced with refines on the boundary
 * schema, mirroring the existing batch-size cap.
 */
import * as z from "zod/v4";
import { INTERVIEW_ENGINE } from "../config";

/**
 * The per-option build-SPEED scale (spec 6 — grounded options). An ORDERED
 * 5-step indicator of how much work the option is to build: `slowest` = most
 * work, `fastest` = least. Distinct from the scout's roughSize/EFFORT_HINTS and
 * the ticket's EffortTier — it answers "how fast can we ship this option", not
 * "how big is the area". A closed-set enum is structured-output-safe (the SDK
 * keeps `enum` constraints), so the generation schema and this boundary schema
 * stay identical. Source of truth for the speed vocabulary across surfaces.
 */
export const SPEED_TIERS = [
  "slowest",
  "slow",
  "moderate",
  "fast",
  "fastest",
] as const;

/**
 * A single answer option (spec 6 — grounded options). `groundingRef` points
 * the option back to the cached scout finding that supports it (null when the
 * session has no findings — the ungrounded fallback). `speed` is the ordered
 * build-speed tier (slowest→fastest, fastest = least build effort). `recommended`
 * flags the single best option (one per question — enforced below).
 */
export const questionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  groundingRef: z.string().nullable(),
  speed: z.enum(SPEED_TIERS),
  recommended: z.boolean(),
});

/** A single generated question. */
export const interviewQuestionSchema = z.object({
  id: z.string(),
  decisionKey: z.string(),
  text: z.string(),
  options: z.array(questionOptionSchema),
  allowOther: z.boolean(),
  dependsOn: z.array(z.string()),
});

/**
 * One question the grounding step dropped because a cached finding already
 * determines its answer (spec T2 — codebase-first skip). The reason is recorded
 * for audit: it persists inside the batch jsonb and replays with the turn, so a
 * skip is never a silent disappearance (spec Risk: over-eager skipping).
 */
export const skippedQuestionSchema = z.object({
  decisionKey: z.string(),
  reason: z.string(),
});

/**
 * The shape the model returns for the structured-output format (no refine —
 * zodOutputFormat targets a plain object schema). `hasOpenMaterialDecisions`
 * feeds the materiality gate (spec What). `skipped` lists questions the findings
 * already answered, with reasons (spec 6); null on the ungrounded path.
 */
export const generatedBatchOutputSchema = z.object({
  questions: z.array(interviewQuestionSchema),
  hasOpenMaterialDecisions: z.boolean(),
  skipped: z.array(skippedQuestionSchema).nullable(),
});

/**
 * The boundary re-validation schema: same shape, plus the hard per-batch caps.
 * An over-long batch, or a question carrying more than one recommended option,
 * is rejected here and never persisted (spec What, Constraints: at most one
 * recommended pick per question).
 */
export const generatedBatchSchema = generatedBatchOutputSchema
  .refine(
    (batch) => batch.questions.length <= INTERVIEW_ENGINE.MAX_QUESTIONS_PER_BATCH,
    {
      message: `A batch may contain at most ${INTERVIEW_ENGINE.MAX_QUESTIONS_PER_BATCH} questions.`,
      path: ["questions"],
    },
  )
  .refine(
    (batch) =>
      batch.questions.every(
        (question) =>
          question.options.filter((option) => option.recommended === true)
            .length <= 1,
      ),
    {
      message: "A question may flag at most one option as recommended.",
      path: ["questions"],
    },
  );

export type GeneratedBatchParsed = z.infer<typeof generatedBatchSchema>;
