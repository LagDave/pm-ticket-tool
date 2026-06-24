/**
 * Input validation schemas for project bits, import, and reconciliation (§11.2).
 * The import file is UNTRUSTED model-generated JSON (spec R5) — it is validated
 * here at the boundary, size/count capped, before any reconciliation. The
 * reconciliation agent's output is re-validated here too before it is trusted
 * (§11.2). Mirrors validation/interviewSession.ts + validation/interviewQuestions.ts.
 */
import { z } from "zod";

/** Bounds — named, not magic (§4.2). */
const KEY_MIN = 1;
const KEY_MAX = 120;
const SUMMARY_MIN = 1;
const SUMMARY_MAX = 2_000;
const MAX_BITS_PER_IMPORT = 200;

/** Bit kinds — mirror types/project.ts BitKind and the DB CHECK. */
export const BIT_KINDS = [
  "feature",
  "constraint",
  "integration",
  "tech_stack",
  "inventory",
] as const;
const bitKindSchema = z.enum(BIT_KINDS);

/** One candidate bit — a manual add, an import row, or a merge proposal. */
export const candidateBitSchema = z.object({
  kind: bitKindSchema,
  bit_key: z.string().trim().min(KEY_MIN, "bit_key is required.").max(KEY_MAX, "bit_key is too long."),
  summary: z.string().trim().min(SUMMARY_MIN, "summary is required.").max(SUMMARY_MAX, "summary is too long."),
});
export type CandidateBitBody = z.infer<typeof candidateBitSchema>;

/** Partial update of one stored bit. */
export const updateBitSchema = z
  .object({
    kind: bitKindSchema,
    bit_key: z.string().trim().min(KEY_MIN).max(KEY_MAX),
    summary: z.string().trim().min(SUMMARY_MIN).max(SUMMARY_MAX),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update.",
  });
export type UpdateBitBody = z.infer<typeof updateBitSchema>;

/** Route params for /projects/:id/bits/:bitId. */
export const bitIdParamSchema = z.object({
  id: z.coerce.number().int().positive("project id must be a positive integer."),
  bitId: z.coerce.number().int().positive("bit id must be a positive integer."),
});
export type BitIdParam = z.infer<typeof bitIdParamSchema>;

/**
 * The uploaded import payload (spec R5 — untrusted). Capped at MAX_BITS_PER_IMPORT
 * so one upload cannot blow the reconciliation call. `force` requests the
 * clear-and-replace path; default false keeps import additive (never clears).
 */
export const importBitsSchema = z.object({
  bits: z
    .array(candidateBitSchema)
    .min(1, "import must contain at least one bit.")
    .max(MAX_BITS_PER_IMPORT, "too many bits in one import."),
  force: z.boolean().optional().default(false),
});
export type ImportBitsBody = z.infer<typeof importBitsSchema>;

/** Body for POST /projects/:id/bits/reconcile — candidates to plan against existing bits. */
export const reconcileBitsSchema = z.object({
  candidates: z
    .array(candidateBitSchema)
    .min(1, "reconcile requires at least one candidate.")
    .max(MAX_BITS_PER_IMPORT, "too many candidates."),
});
export type ReconcileBitsBody = z.infer<typeof reconcileBitsSchema>;

/** Boundary re-validation of the reconciliation agent's structured output (§11.2). */
const RECONCILIATION_ACTIONS = [
  "insert",
  "update",
  "skip_duplicate",
  "conflict",
  "similar",
] as const;
export const reconciliationPlanSchema = z.object({
  actions: z.array(
    z.object({
      incomingIndex: z.number().int().nonnegative(),
      action: z.enum(RECONCILIATION_ACTIONS),
      targetBitId: z.number().int().positive().nullable().optional(),
      relatedBitIds: z.array(z.number().int().positive()).optional(),
      mergedSummary: z.string().nullable().optional(),
      reason: z.string(),
    }),
  ),
});

/**
 * Body for POST /projects/:id/bits/apply — the human-confirmed resolutions from
 * the resolve screen, paired with the candidates they resolve. Applied in a
 * transaction (§10.5); `force` choices override conflict/similar flags.
 */
const RESOLUTION_CHOICES = ["insert", "merge", "keep_both", "skip", "force"] as const;
export const applyResolutionsSchema = z.object({
  candidates: z.array(candidateBitSchema).min(1).max(MAX_BITS_PER_IMPORT),
  resolutions: z
    .array(
      z.object({
        incomingIndex: z.number().int().nonnegative(),
        choice: z.enum(RESOLUTION_CHOICES),
        targetBitId: z.number().int().positive().nullable().optional(),
        summary: z.string().trim().min(SUMMARY_MIN).max(SUMMARY_MAX).nullable().optional(),
      }),
    )
    .min(1),
});
export type ApplyResolutionsBody = z.infer<typeof applyResolutionsSchema>;
