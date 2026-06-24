/**
 * Validation middleware (§11.2). Applies a zod schema to a request part at the
 * boundary and writes the parsed, typed value back, so controllers receive
 * trusted input. On failure it surfaces field names + messages via the typed
 * InterviewError (mapped to 400) — never leaks internals (§3.4).
 */
import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { InterviewError } from "../controllers/interview/feature-utils/InterviewError";

type RequestPart = "body" | "params" | "query";

export function validate(schema: ZodSchema, part: RequestPart = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      next(
        new InterviewError("VALIDATION_ERROR", "Request validation failed.", {
          fields,
        }),
      );
      return;
    }
    // Reassign the validated, coerced value (e.g. :id string -> number).
    (req[part] as unknown) = result.data;
    next();
  };
}
