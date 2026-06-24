/**
 * CodeScoutAgent tests (§20.1, §20.2). BOTH external seams are mocked for
 * determinism (§20.4): the Anthropic SDK (its `messages.parse`) and the
 * CodeContextProvider (a synthetic fake that counts calls). Covers the HARD CAPS
 * (spec Must: a bounded scout, not free-roaming) — search calls ≤ MAX_SEARCH_CALLS,
 * files read ≤ MAX_FILES_READ — that the areas are capped at MAX_AREAS, that the
 * "verify with engineering" flag is stamped TRUE structurally (spec Risk), and
 * that an off-schema model result throws (never persisted, §11.2).
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
vi.mock("../../config", async () => {
  const actual = await vi.importActual<typeof import("../../config")>("../../config");
  return { ...actual, requireAnthropicApiKey: vi.fn(() => "test-key") };
});

import { SCOUT } from "../../config";
import { makeScoutSummary } from "../../test/factories";
import type {
  CodeContextProvider,
  CodeSearchHit,
  RepoFileContent,
} from "../../services/codeContext/CodeContextProvider";
import type { CodeContextProviderId, RepoRef } from "../../types/codeScout";
import { CodeScoutAgent } from "./CodeScoutAgent";

const repo: RepoRef = { provider: "github", repoRef: "octocat/hello-world" };

/** Wrap a parsed summary in the SDK's message shape. */
function parsedMessage(parsedOutput: unknown) {
  return { parsed_output: parsedOutput, stop_reason: "end_turn" };
}

/**
 * A counting fake provider. Every search returns `hitsPerSearch` synthetic hits
 * with UNIQUE paths (so the file-read cap, not de-dup, is what bounds reads).
 */
class FakeProvider implements CodeContextProvider {
  readonly id: CodeContextProviderId = "github";
  searchCalls = 0;
  fileReads = 0;
  constructor(private readonly hitsPerSearch = 5) {}

  async searchCode(_repo: RepoRef, query: string, limit: number): Promise<CodeSearchHit[]> {
    this.searchCalls += 1;
    const n = Math.min(this.hitsPerSearch, limit);
    return Array.from({ length: n }, (_, i) => ({
      path: `src/${query}-${i}.ts`,
      snippet: "",
    }));
  }
  async readFile(_repo: RepoRef, path: string, maxBytes: number): Promise<RepoFileContent> {
    this.fileReads += 1;
    const content = `// content of ${path}`.slice(0, maxBytes);
    return { path, content, truncated: false };
  }
}

describe("CodeScoutAgent", () => {
  beforeEach(() => {
    mockParse.mockReset();
  });

  it("caps provider search calls and file reads (spec Must: bounded scout)", async () => {
    mockParse.mockResolvedValueOnce(parsedMessage(makeScoutSummary()));
    const fake = new FakeProvider(5);

    await CodeScoutAgent.run(fake, {
      originalRequest: "Add authentication and reporting and exporting features",
      repo,
    });

    // HARD CAPS — never exceeded regardless of how much the repo could yield.
    expect(fake.searchCalls).toBeLessThanOrEqual(SCOUT.MAX_SEARCH_CALLS);
    expect(fake.fileReads).toBeLessThanOrEqual(SCOUT.MAX_FILES_READ);
    // Exactly one model summarization call (bounded, not a loop).
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it("stamps verifyWithEngineering true and caps areas at MAX_AREAS (spec Risk)", async () => {
    // Model returns MORE areas than the cap; the agent must truncate them.
    const tooMany = Array.from({ length: SCOUT.MAX_AREAS + 3 }, (_, i) => ({
      area: `Area ${i}`,
      whatExists: "exists",
      roughSize: "S" as const,
      whatItTouches: [],
      feasibility: "likely" as const,
      paths: [],
    }));
    mockParse.mockResolvedValueOnce(
      parsedMessage(makeScoutSummary({ relevantAreas: tooMany })),
    );

    const findings = await CodeScoutAgent.run(new FakeProvider(), {
      originalRequest: "Build a thing",
      repo,
    });

    expect(findings.verifyWithEngineering).toBe(true); // structural, not a model choice
    expect(findings.relevantAreas.length).toBeLessThanOrEqual(SCOUT.MAX_AREAS);
    expect(findings.summary).toBeTruthy();
  });

  it("throws SCOUT_GENERATION_INVALID on an off-schema model result (never persisted)", async () => {
    // Missing relevantAreas → boundary parse fails.
    mockParse.mockResolvedValueOnce(parsedMessage({ summary: "only a summary" }));

    await expect(
      CodeScoutAgent.run(new FakeProvider(), { originalRequest: "x", repo }),
    ).rejects.toMatchObject({ code: "SCOUT_GENERATION_INVALID" });
  });

  it("retries on the fallback model when the primary call rejects", async () => {
    mockParse
      .mockRejectedValueOnce(new Error("primary rejected the model"))
      .mockResolvedValueOnce(parsedMessage(makeScoutSummary()));

    const findings = await CodeScoutAgent.run(new FakeProvider(), {
      originalRequest: "Add login",
      repo,
    });

    expect(findings.verifyWithEngineering).toBe(true);
    expect(mockParse).toHaveBeenCalledTimes(2); // primary then fallback
  });

  it("throws SCOUT_GENERATION_FAILED when both models fail", async () => {
    mockParse.mockRejectedValue(new Error("model down"));

    await expect(
      CodeScoutAgent.run(new FakeProvider(), { originalRequest: "x", repo }),
    ).rejects.toMatchObject({ code: "SCOUT_GENERATION_FAILED" });
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("still summarizes when the provider yields an empty sample (degrades, does not throw)", async () => {
    mockParse.mockResolvedValueOnce(parsedMessage(makeScoutSummary({ relevantAreas: [] })));
    const emptyProvider = new FakeProvider(0); // searches return nothing

    const findings = await CodeScoutAgent.run(emptyProvider, {
      originalRequest: "Add a thing",
      repo,
    });

    expect(emptyProvider.fileReads).toBe(0); // no paths → no reads
    expect(findings.verifyWithEngineering).toBe(true);
    expect(mockParse).toHaveBeenCalledTimes(1);
  });
});
