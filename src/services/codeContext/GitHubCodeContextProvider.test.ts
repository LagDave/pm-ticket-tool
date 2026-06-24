/**
 * GitHubCodeContextProvider tests (§20.1, §20.2). The network is mocked at the
 * global `fetch` seam and the token accessor is mocked at the config seam, so the
 * suite is deterministic and offline — no live GitHub call (the ONE live scan is
 * exercised by a separate script, not the unit suite). Covers: the provider
 * interface (searchCode/readFile), per-call BOUNDS (hit cap, byte truncation),
 * the typed error paths (auth / rate-limit / not-found) mapped to CodeScoutError
 * codes with NO token or internal leak (§3.4, §5.3), and that the Authorization
 * header is sent only when a token is configured (§5.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the token accessor; default = unauthenticated (public-repo scan).
vi.mock("../../config", async () => {
  const actual = await vi.importActual<typeof import("../../config")>("../../config");
  return { ...actual, getGitHubToken: vi.fn(() => null) };
});

import { getGitHubToken } from "../../config";
import { CodeScoutError } from "../../controllers/codeScout/feature-utils/CodeScoutError";
import { GitHubCodeContextProvider } from "./GitHubCodeContextProvider";
import type { RepoRef } from "../../types/codeScout";

const mockToken = vi.mocked(getGitHubToken);
const repo: RepoRef = { provider: "github", repoRef: "octocat/hello-world" };
// Fresh provider per test (beforeEach) so the per-instance tree cache never
// leaks between tests.
let provider: GitHubCodeContextProvider;

/** Build a Headers object the provider can read x-ratelimit-remaining from. */
function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

/** A minimal fetch Response stub. */
function jsonResponse(body: unknown, status = 200, hdrs: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(hdrs),
    json: async () => body,
  } as unknown as Response;
}

/** Stub global fetch with a typed mock and return it for call inspection. */
function stubFetch(impl: (url: URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock =
    vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GitHubCodeContextProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockToken.mockReturnValue(null);
    provider = new GitHubCodeContextProvider();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the github provider id", () => {
    expect(provider.id).toBe("github");
  });

  it("searchCode filters tree blobs by the query and caps at the limit", async () => {
    // A mix of matching login* files, non-matching files, and a non-blob node.
    const tree = [
      ...Array.from({ length: 25 }, (_, i) => ({
        path: `src/login-${i}.ts`,
        type: "blob",
      })),
      { path: "src/unrelated.ts", type: "blob" },
      { path: "src", type: "tree" }, // a directory node — must be ignored
    ];
    const fetchMock = stubFetch(async () => jsonResponse({ tree }));

    const hits = await provider.searchCode(repo, "login", 10);

    expect(hits).toHaveLength(10); // capped (spec Must: bounded per call)
    expect(hits.every((h) => h.path.includes("login"))).toBe(true);
    expect(hits[0]).toEqual({ path: "src/login-0.ts", snippet: "" });
    // The tree endpoint is scoped to the repo.
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/repos/octocat/hello-world/git/trees/");
  });

  it("searchCode caches the tree — a second search adds no extra API call", async () => {
    const tree = [
      { path: "src/auth.ts", type: "blob" },
      { path: "src/user.ts", type: "blob" },
    ];
    const fetchMock = stubFetch(async () => jsonResponse({ tree }));

    await provider.searchCode(repo, "auth", 5);
    await provider.searchCode(repo, "user", 5);

    // Tree fetched once; the second search reuses the cache (no second call).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("searchCode tolerates a missing tree array (returns [])", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    expect(await provider.searchCode(repo, "x", 5)).toEqual([]);
  });

  it("readFile decodes base64 content and reports not truncated under the cap", async () => {
    const content = "export const x = 1;\n";
    const b64 = Buffer.from(content, "utf8").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ type: "file", content: b64, encoding: "base64" })),
    );

    const file = await provider.readFile(repo, "src/x.ts", 50_000);
    expect(file.path).toBe("src/x.ts");
    expect(file.content).toBe(content);
    expect(file.truncated).toBe(false);
  });

  it("readFile truncates content to maxBytes and flags it (spec Must: bounded)", async () => {
    const content = "abcdefghijklmnopqrstuvwxyz";
    const b64 = Buffer.from(content, "utf8").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ type: "file", content: b64 })),
    );

    const file = await provider.readFile(repo, "src/long.ts", 5);
    expect(file.content).toBe("abcde");
    expect(file.truncated).toBe(true);
  });

  it("readFile throws PROVIDER_FILE_NOT_FOUND when the path is not a file blob", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ type: "dir" })));
    await expect(provider.readFile(repo, "src", 50_000)).rejects.toMatchObject({
      code: "PROVIDER_FILE_NOT_FOUND",
    });
  });

  it("maps 401 to a typed PROVIDER_AUTH_FAILED error (no leak)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    await expect(provider.searchCode(repo, "x", 5)).rejects.toBeInstanceOf(CodeScoutError);
    await expect(provider.searchCode(repo, "x", 5)).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
    });
  });

  it("maps a rate-limited 403 to PROVIDER_RATE_LIMITED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 403, { "x-ratelimit-remaining": "0" })),
    );
    await expect(provider.searchCode(repo, "x", 5)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("maps 404 to PROVIDER_NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    await expect(provider.searchCode(repo, "x", 5)).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });

  it("maps a transport throw to PROVIDER_REQUEST_FAILED (never leaks the cause)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED 1.2.3.4");
      }),
    );
    const err = await provider.searchCode(repo, "x", 5).catch((e) => e);
    expect(err).toBeInstanceOf(CodeScoutError);
    expect(err.code).toBe("PROVIDER_REQUEST_FAILED");
    // The internal network detail is not surfaced in the typed message (§3.4).
    expect(err.message).not.toContain("ECONNREFUSED");
  });

  it("omits the Authorization header when no token is configured (public scan)", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ items: [] }));
    mockToken.mockReturnValue(null);

    await provider.searchCode(repo, "x", 5);

    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
    expect(sentHeaders["User-Agent"]).toBe("pm-ticket-tool-code-scout");
  });

  it("sends a Bearer header only when a token is configured (§5.1)", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ items: [] }));
    mockToken.mockReturnValue("ghp_secrettoken");

    await provider.searchCode(repo, "x", 5);

    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe("Bearer ghp_secrettoken");
  });
});
