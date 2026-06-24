/**
 * Input validation schemas for the project domain (§11.2). Validation happens at
 * the boundary as route middleware; once data reaches the controller it is
 * trusted. Mirrors validation/interviewSession.ts.
 */
import { z } from "zod";

/** Bounds — named, not magic (§4.2). */
const NAME_MIN = 1;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2_000;

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(NAME_MIN, "name is required.")
    .max(NAME_MAX, "name is too long."),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, "description is too long.")
    .optional()
    .nullable(),
});
export type CreateProjectBody = z.infer<typeof createProjectSchema>;

/** Partial update — at least one field; both optional, nothing else accepted. */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN, "name is required.").max(NAME_MAX, "name is too long."),
    description: z.string().trim().max(DESCRIPTION_MAX, "description is too long.").nullable(),
  })
  .partial()
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "Provide at least one field to update.",
  });
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

/** Route param schema for :id — a positive integer id. */
export const projectIdParamSchema = z.object({
  id: z.coerce.number().int().positive("project id must be a positive integer."),
});
export type ProjectIdParam = z.infer<typeof projectIdParamSchema>;
