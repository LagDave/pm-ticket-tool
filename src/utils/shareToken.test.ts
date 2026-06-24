/**
 * shareToken util tests (§20.1). Proves the token is URL-safe, carries enough
 * entropy to be unguessable (spec Risk), and is distinct per call.
 */
import { describe, expect, it } from "vitest";
import { generateShareToken } from "./shareToken";

describe("generateShareToken", () => {
  it("returns a URL-safe base64url token (no +, /, or = padding)", () => {
    expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("encodes 256 bits — at least 43 base64url chars", () => {
    // 32 bytes → ceil(32 * 4 / 3) = 43 unpadded base64url chars.
    expect(generateShareToken().length).toBeGreaterThanOrEqual(43);
  });

  it("produces a distinct token on every call", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
  });
});
