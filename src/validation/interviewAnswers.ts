/**
 * Input validation for the engine endpoints (§11.2). Validation happens at the
 * boundary; once data reaches the controller it is trusted. The deeper
 * cross-check — that each answer matches a question in the open batch — lives in
 * the service (it needs the persisted turn). This schema enforces the wire
 * shape: well-formed answer objects and the optional stop-and-generate flag.
 */
import { z } from "zod";

/** Bounds for a free-text "other" answer. Named, not magic (§4.2). */
const OTHER_TEXT_MAX_LENGTH = 2_000;

const submittedAnswerSchema = z.object({
  questionId: z.string().trim().min(1, "questionId is required."),
  optionId: z.string().trim().min(1).nullable(),
  otherText: z.string().trim().max(OTHER_TEXT_MAX_LENGTH).nullable(),
});

export const submitAnswersSchema = z.object({
  answers: z.array(submittedAnswerSchema),
  stopAndGenerate: z.boolean().optional(),
});

export type SubmitAnswersBody = z.infer<typeof submitAnswersSchema>;
