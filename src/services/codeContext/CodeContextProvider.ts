/**
 * CodeContextProvider — the source-agnostic seam the code scout reads a repo
 * through (spec T1, §6.2 top-level shared service). It defines only GENERIC repo
 * operations — search code, read one file — so the source can change (GitHub
 * now, Azure Repos later) without rewriting the scout (spec Constraints). No
 * GitHub- or Azure-specific type leaks into this interface; provider-native
 * details (tokens, API shapes) stay inside the implementation.
 *
 * The scout drives this interface under HARD CAPS (config SCOUT.*): it is a
 * bounded scout, not a free-roaming agent (spec Must). The caps live in the
 * orchestration (CodeScoutAgent), not here — the interface just exposes the two
 * primitive reads the scout composes.
 */
import type { CodeContextProviderId, RepoRef } from "../../types/codeScout";

/** One code-search hit — a file path and a short matched snippet. Source-agnostic. */
export interface CodeSearchHit {
  /** Repo-relative file path the match was found in. */
  path: string;
  /** A short snippet/preview of the match, for orientation (may be empty). */
  snippet: string;
}

/** A file's content as read from the repo. `truncated` flags a capped read. */
export interface RepoFileContent {
  path: string;
  content: string;
  /** True when the content was truncated to stay within the per-file byte cap. */
  truncated: boolean;
}

/**
 * Reads a repository for orientation. Implementations are server-side only and
 * read any credential from config (§5.1, §17.3); they never log it (§5.3) and
 * surface a typed error (not a leak) on auth/rate-limit failure (§3.4).
 */
export interface CodeContextProvider {
  /** Which source this provider serves — selects it from a RepoRef.provider. */
  readonly id: CodeContextProviderId;

  /**
   * Search code in the repo for a query, returning at most `limit` hits. Bounded
   * by the caller; the implementation must also cap its own API usage.
   */
  searchCode(repo: RepoRef, query: string, limit: number): Promise<CodeSearchHit[]>;

  /**
   * Read one file from the repo, truncated to at most `maxBytes`. Used sparingly
   * by the scout (it reads only a few files within the cap). Throws a typed error
   * when the file is missing or the read fails.
   */
  readFile(repo: RepoRef, path: string, maxBytes: number): Promise<RepoFileContent>;
}
