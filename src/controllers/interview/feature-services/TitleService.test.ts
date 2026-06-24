/**
 * TitleService tests (§20.1, §20.2). The title agent's model call is mocked at
 * its seam (vi.mock of titleAgent.generateTitle) so the suite is deterministic
 * and free — no live model call (§20.4); the real sanitizeTitle is kept so the
 * service's parse-then-sanitize path is exercised end to end. Covers: a clean
 * title flows through sanitized; an off-schema result degrades to null; a null
 * model output degrades to null; both-models-failing degrades to null (NEVER
 * throws — a title is not a hard gate); the fallback model recovers a primary
 * rejection; and quotes/em-dashes are scrubbed via the real sanitizer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock only generateTitle; keep the real sanitizeTitle so the service's
// boundary-parse → sanitize path runs for real.
vi.mock("../../../agents/titleAgent", async () => {
  const actual =
    await vi.importActual<typeof import("../../../agents/titleAgent")>(
      "../../../agents/titleAgent",
    );
  return { ...actual, generateTitle: vi.fn() };
});

import { generateTitle } from "../../../agents/titleAgent";
import type { TitleSource } from "../../../agents/titleAgent";
import { TitleService } from "./TitleService";

const mockGenerate = vi.mocked(generateTitle);

const REQUEST_SOURCE: TitleSource = {
  kind: "request",
  originalRequest: "Build a passwordless login.",
};

describe("TitleService", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  it("returns a sanitized title on a clean model result", async () => {
    mockGenerate.mockResolvedValueOnce({ title: "Add magic-link login" });

    const title = await TitleService.generate(REQUEST_SOURCE);

    expect(title).toBe("Add magic-link login");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("scrubs surrounding quotes and em-dashes via the real sanitizer (Feature 2)", async () => {
    mockGenerate.mockResolvedValueOnce({ title: '"Add login — verify with engineering"' });

    const title = await TitleService.generate(REQUEST_SOURCE);

    expect(title).toBe("Add login, verify with engineering");
    expect(title).not.toMatch(/[—–"]/);
  });

  it("degrades to null on an off-schema model result (not a hard gate)", async () => {
    // `title` is not a string → boundary parse fails → null, no throw.
    mockGenerate.mockResolvedValueOnce({ title: 123 });

    const title = await TitleService.generate(REQUEST_SOURCE);
    expect(title).toBeNull();
  });

  it("degrades to null when the model returns null (unparseable output)", async () => {
    mockGenerate.mockResolvedValueOnce(null);

    const title = await TitleService.generate(REQUEST_SOURCE);
    expect(title).toBeNull();
  });

  it("degrades to null when a clean title sanitizes to nothing usable", async () => {
    mockGenerate.mockResolvedValueOnce({ title: '"   "' });

    const title = await TitleService.generate(REQUEST_SOURCE);
    expect(title).toBeNull();
  });

  it("degrades to null (never throws) when both models fail, after a fallback retry", async () => {
    mockGenerate.mockRejectedValue(new Error("model down")); // primary + fallback

    const title = await TitleService.generate(REQUEST_SOURCE);

    expect(title).toBeNull();
    expect(mockGenerate).toHaveBeenCalledTimes(2); // primary then fallback
  });

  it("recovers on the fallback model when the primary rejects", async () => {
    mockGenerate
      .mockRejectedValueOnce(new Error("primary rejected the model"))
      .mockResolvedValueOnce({ title: "Recovered title" });

    const title = await TitleService.generate(REQUEST_SOURCE);

    expect(title).toBe("Recovered title");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});
