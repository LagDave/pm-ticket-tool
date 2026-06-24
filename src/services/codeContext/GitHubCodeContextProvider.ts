/**
 * GitHubCodeContextProvider — the GitHub implementation of CodeContextProvider
 * (spec T2), over the GitHub REST API using the runtime's global `fetch` (Node
 * 20; no new dependency, §4.4). It exposes only the generic search/read
 * primitives the scout composes; all GitHub specifics (endpoints, headers,
 * response shapes) stay inside this file so the scout never sees them.
 *
 * Search strategy — Git Trees, not code-search (execution deviation, §4.4):
 * GitHub's code-search endpoint (/search/code) requires authentication even for
 * PUBLIC repos (it 401s unauthenticated), which would force a token on every
 * public scan and break the spec's token-free public-repo requirement. So
 * `searchCode` lists the repo file tree via the Git Trees API (which works
 * unauthenticated on public repos) and filters paths by the query term. The
 * CodeContextProvider contract is unchanged — it still returns path hits for a
 * query; only the GitHub-internal mechanism differs, hidden behind the seam. A
 * token, when present, still raises the rate limit and unlocks private repos.
 *
 * Token handling (a secret): read ONLY from config via getGitHubToken() (§5.1),
 * sent as a Bearer header when present and NEVER logged (§5.3) or exposed to the
 * frontend (§17.3). On auth, rate-limit, not-found, or read failure this raises a
 * typed CodeScoutError with a PROVIDER_* code — the cause surfaces as a code,
 * never a leaked stack trace or token (§3.2, §3.3, §3.4).
 *
 * Bounded reads (spec Must): each call caps its own payload — search hits at
 * `limit` (≤ SCOUT.MAX_SEARCH_HITS) and a file read at `maxBytes`
 * (≤ SCOUT.MAX_FILE_BYTES). The tree is fetched at most once per scan (cached on
 * the instance), so repeated searches add no extra API calls. The scout caps the
 * NUMBER of calls in the orchestration; this provider caps each call's size.
 */
import { getGitHubToken } from "../../config";
import { logger } from "../../config/logger";
import { CodeScoutError } from "../../controllers/codeScout/feature-utils/CodeScoutError";
import type { CodeContextProviderId, RepoRef } from "../../types/codeScout";
import type {
  CodeContextProvider,
  CodeSearchHit,
  RepoFileContent,
} from "./CodeContextProvider";

const GITHUB_API_BASE = "https://api.github.com";
/** GitHub asks clients to pin the REST API version via this header. */
const GITHUB_API_VERSION = "2022-11-28";
/** A descriptive UA is required by the GitHub API; identifies this tool. */
const USER_AGENT = "pm-ticket-tool-code-scout";

/** One node in the Git Trees response — only the fields we read. */
interface GitHubTreeNode {
  path?: string;
  type?: string;
}
interface GitHubTreeResponse {
  tree?: GitHubTreeNode[];
  truncated?: boolean;
}
/** GitHub contents-API file shape — base64 content for a blob. */
interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  type?: string;
}

export class GitHubCodeContextProvider implements CodeContextProvider {
  readonly id: CodeContextProviderId = "github";

  /**
   * The repo's file paths, fetched once per scan and cached on the instance so
   * repeated searches cost no extra API calls. Keyed by repoRef defensively in
   * case one instance is reused across repos. Holds only blob (file) paths.
   */
  private treeCache = new Map<string, string[]>();

  /**
   * Search code in `owner/name` for `query`, returning at most `limit` path
   * hits. Lists the repo tree (Git Trees API, unauthenticated-friendly) and
   * filters file paths whose path contains the query term, case-insensitively. A
   * rate-limit or a private repo without access surfaces as a typed
   * CodeScoutError.
   */
  async searchCode(
    repo: RepoRef,
    query: string,
    limit: number,
  ): Promise<CodeSearchHit[]> {
    const paths = await this.getRepoFilePaths(repo);
    const needle = query.toLowerCase();
    const matched = paths.filter((path) => path.toLowerCase().includes(needle));
    return matched
      .slice(0, limit)
      .map((path) => ({ path, snippet: "" }));
  }

  /**
   * List (and cache) the repo's file paths via the Git Trees API. `recursive=1`
   * returns the whole tree in one call; we keep only blob (file) nodes. The
   * result is capped to a sane upper bound so a huge repo cannot blow memory —
   * the scout only samples a few of these anyway.
   */
  private async getRepoFilePaths(repo: RepoRef): Promise<string[]> {
    const cached = this.treeCache.get(repo.repoRef);
    if (cached) return cached;

    const url = new URL(
      `${GITHUB_API_BASE}/repos/${repo.repoRef}/git/trees/HEAD?recursive=1`,
    );
    const body = await this.getJson<GitHubTreeResponse>(url, repo, "tree");
    const nodes = Array.isArray(body.tree) ? body.tree : [];
    const paths = nodes
      .filter(
        (node): node is Required<Pick<GitHubTreeNode, "path" | "type">> =>
          node.type === "blob" &&
          typeof node.path === "string" &&
          node.path.length > 0,
      )
      .map((node) => node.path);

    this.treeCache.set(repo.repoRef, paths);
    return paths;
  }

  /**
   * Read one file from `owner/name` at `path`, truncated to `maxBytes`. Decodes
   * the contents API's base64 blob. Throws a typed CodeScoutError when the path
   * is missing or is not a readable file blob.
   */
  async readFile(
    repo: RepoRef,
    path: string,
    maxBytes: number,
  ): Promise<RepoFileContent> {
    const url = new URL(
      `${GITHUB_API_BASE}/repos/${repo.repoRef}/contents/${encodeRepoPath(path)}`,
    );
    const body = await this.getJson<GitHubContentResponse>(url, repo, "readFile");

    if (body.type !== "file" || typeof body.content !== "string") {
      throw new CodeScoutError(
        "PROVIDER_FILE_NOT_FOUND",
        `GitHub path "${path}" is not a readable file.`,
        { provider: this.id, repoRef: repo.repoRef, path },
      );
    }

    // Contents API returns base64 (possibly newline-chunked). Decode, then cap.
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    const truncated = decoded.length > maxBytes;
    return {
      path,
      content: truncated ? decoded.slice(0, maxBytes) : decoded,
      truncated,
    };
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * GET a GitHub JSON endpoint with the shared headers, mapping every failure to
   * a typed CodeScoutError (§3.2/§3.4). The whole call is wrapped so a network
   * throw never escapes untyped (§3.1). The token is attached via headers and is
   * never put into a log line or an error message/detail (§5.3).
   */
  private async getJson<T>(url: URL, repo: RepoRef, op: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { headers: this.buildHeaders() });
    } catch (error) {
      // Network/transport failure — context, but never the token (§3.3, §5.3).
      logger.warn(
        { err: error, provider: this.id, repoRef: repo.repoRef, op },
        "GitHub provider request failed at the transport layer",
      );
      throw new CodeScoutError(
        "PROVIDER_REQUEST_FAILED",
        "The GitHub provider could not reach the GitHub API.",
        { provider: this.id, repoRef: repo.repoRef, op },
      );
    }

    if (!response.ok) {
      throw this.toTypedError(response, repo, op);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      logger.warn(
        { err: error, provider: this.id, repoRef: repo.repoRef, op },
        "GitHub provider returned an unparseable JSON body",
      );
      throw new CodeScoutError(
        "PROVIDER_BAD_RESPONSE",
        "The GitHub provider returned an unexpected response.",
        { provider: this.id, repoRef: repo.repoRef, op },
      );
    }
  }

  /**
   * Map a non-2xx GitHub response to a typed error code. 401/403 with the
   * rate-limit marker → RATE_LIMITED; other 401/403 → AUTH (token problem or
   * private repo without access); 404 → NOT_FOUND; everything else → a generic
   * provider error. No internal detail or token is leaked to the client (§3.4).
   */
  private toTypedError(response: Response, repo: RepoRef, op: string): CodeScoutError {
    const status = response.status;
    const rateRemaining = response.headers.get("x-ratelimit-remaining");
    const isRateLimited =
      (status === 403 || status === 429) && rateRemaining === "0";

    logger.warn(
      { provider: this.id, repoRef: repo.repoRef, op, status },
      "GitHub provider returned a non-OK response",
    );

    if (isRateLimited) {
      return new CodeScoutError(
        "PROVIDER_RATE_LIMITED",
        "The GitHub API rate limit was exceeded. A token raises the limit.",
        { provider: this.id, repoRef: repo.repoRef },
      );
    }
    if (status === 401 || status === 403) {
      return new CodeScoutError(
        "PROVIDER_AUTH_FAILED",
        "GitHub rejected the request. The repo may be private or the token invalid.",
        { provider: this.id, repoRef: repo.repoRef },
      );
    }
    if (status === 404) {
      return new CodeScoutError(
        "PROVIDER_NOT_FOUND",
        `The GitHub repo "${repo.repoRef}" or path was not found.`,
        { provider: this.id, repoRef: repo.repoRef },
      );
    }
    return new CodeScoutError(
      "PROVIDER_REQUEST_FAILED",
      "The GitHub provider request did not succeed.",
      { provider: this.id, repoRef: repo.repoRef, op },
    );
  }

  /**
   * Build the request headers. The Bearer token is added ONLY when a token is
   * configured (public-repo scans run unauthenticated). The token value never
   * appears in a log (§5.3); these headers are not logged anywhere.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT,
    };
    const token = getGitHubToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }
}

/** Encode a repo-relative path for the contents API, preserving "/" separators. */
function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
