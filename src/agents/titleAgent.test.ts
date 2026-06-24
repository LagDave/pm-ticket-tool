/**
 * titleAgent tests (§20.1, §20.2). The Anthropic SDK is mocked at its seam (its
 * `messages.parse`) so the suite is deterministic and free — no live model call
 * (§20.4). Covers: the SDK is invoked once per generate (request and ticket
 * sources both reach it), the raw parsed output is returned for the caller to
 * re-validate (§11.2), and — the load-bearing part — sanitizeTitle strips
 * surrounding quotes, removes em-dashes/en-dashes (Feature 2: no em-dashes in
 * user-facing output), caps to the word target and the character backstop, and
 * degrades an empty/garbage title to null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK: the constructor returns an object exposing messages.parse.
const mockParse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse: mockParse };
  },
}));
// zodOutputFormat is called for the `format` option; stub it to a plain value.
vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn(() => ({})),
}));
// A token is needed only by requireAnthropicApiKey at first client use.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return { ...actual, requireAnthropicApiKey: vi.fn(() => "test-key") };
});

import { TITLE_MAX_WORDS } from "../validation/title";
import { generateTitle, sanitizeTitle } from "./titleAgent";

/** Wrap a parsed title in the SDK's message shape. */
function parsedMessage(parsedOutput: unknown) {
  return { parsed_output: parsedOutput, stop_reason: "end_turn" };
}

describe("titleAgent.sanitizeTitle", () => {
  it("returns a clean title unchanged", () => {
    expect(sanitizeTitle("Add magic-link login")).toBe("Add magic-link login");
  });

  it("strips a single pair of surrounding straight or curly quotes", () => {
    expect(sanitizeTitle('"Add login"')).toBe("Add login");
    expect(sanitizeTitle("“Add login”")).toBe("Add login");
    expect(sanitizeTitle("'Add login'")).toBe("Add login");
  });

  it("removes em-dashes and en-dashes, replacing them with a comma (Feature 2)", () => {
    expect(sanitizeTitle("Add login — verify with engineering")).toBe(
      "Add login, verify with engineering",
    );
    expect(sanitizeTitle("Reporting – exports")).toBe("Reporting, exports");
    // No dash of either kind survives.
    expect(sanitizeTitle("a—b–c")).not.toMatch(/[—–]/);
  });

  it("caps the title to the word target", () => {
    const long = "one two three four five six seven eight nine ten";
    const out = sanitizeTitle(long);
    expect(out).not.toBeNull();
    expect(out!.split(" ")).toHaveLength(TITLE_MAX_WORDS);
    expect(out).toBe("one two three four five six seven eight");
  });

  it("drops a trailing sentence-ending punctuation mark", () => {
    expect(sanitizeTitle("Add a reporting dashboard.")).toBe("Add a reporting dashboard");
  });

  it("collapses internal whitespace and newlines", () => {
    expect(sanitizeTitle("Add   login\n flow")).toBe("Add login flow");
  });

  it("degrades empty / quotes-only input to null", () => {
    expect(sanitizeTitle("")).toBeNull();
    expect(sanitizeTitle('"   "')).toBeNull();
    expect(sanitizeTitle("   ")).toBeNull();
  });
});

describe("titleAgent.generateTitle", () => {
  beforeEach(() => {
    mockParse.mockReset();
  });

  it("makes exactly one bounded model call for a request source and returns the parsed output", async () => {
    mockParse.mockResolvedValueOnce(parsedMessage({ title: "Add magic-link login" }));

    const out = await generateTitle({
      kind: "request",
      originalRequest: "Build a passwordless login.",
    });

    expect(out).toEqual({ title: "Add magic-link login" });
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it("makes one call for a ticket source too (the second, post-finalize title)", async () => {
    mockParse.mockResolvedValueOnce(parsedMessage({ title: "Refine the dashboard" }));

    const out = await generateTitle({
      kind: "ticket",
      userStory: "As a PM, I want a dashboard, So that I can track work.",
      contextSummary: "A dashboard of the PM's sessions.",
      acceptanceCriteria: [
        { given: "sessions exist", when: "the PM opens the dashboard", then: "they are listed" },
      ],
      effort: "M",
    });

    expect(out).toEqual({ title: "Refine the dashboard" });
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it("returns null parsed output as-is for the caller to handle (no throw)", async () => {
    mockParse.mockResolvedValueOnce(parsedMessage(null));
    const out = await generateTitle({ kind: "request", originalRequest: "x" });
    expect(out).toBeNull();
  });
});
