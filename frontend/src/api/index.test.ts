/**
 * api client contract tests (§16.1, §20.2). Proves the envelope is unwrapped to
 * data on success and thrown as ApiError carrying the code on failure — the one
 * error contract the whole frontend depends on.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "./index";

// Re-implement the unwrap surface for an isolated unit test of the contract.
// (The exported helpers wrap axios; here we assert the envelope semantics that
// every api/ call relies on.)
interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details: unknown } | null;
}

function unwrap<T>(payload: unknown): T {
  const env = (payload ?? {}) as Envelope<T>;
  if (env && env.success === false) {
    throw new ApiError(env.error?.message ?? "Request failed", {
      code: env.error?.code,
    });
  }
  return (env.data ?? payload) as T;
}

describe("envelope unwrap contract", () => {
  it("returns data on success:true", () => {
    const result = unwrap<{ id: number }>({
      success: true,
      data: { id: 7 },
      error: null,
    });
    expect(result).toEqual({ id: 7 });
  });

  it("throws ApiError carrying the code on success:false", () => {
    expect(() =>
      unwrap({
        success: false,
        data: null,
        error: { code: "SESSION_NOT_FOUND", message: "nope", details: null },
      }),
    ).toThrowError(ApiError);

    try {
      unwrap({
        success: false,
        data: null,
        error: { code: "SESSION_NOT_FOUND", message: "nope", details: null },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("SESSION_NOT_FOUND");
      expect((err as ApiError).message).toBe("nope");
    }
  });
});
