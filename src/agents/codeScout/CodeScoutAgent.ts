/**
 * CodeScoutAgent — the bounded scout (spec T4, §6.2). Given a session's request
 * and a repo, it reads the repo through a CodeContextProvider under HARD CAPS
 * and returns coarse, orientation-only findings. It is a BOUNDED scout, not a
 * free-roaming agent (spec Must): the number of provider search calls and file
 * reads is capped by config (SCOUT.MAX_SEARCH_CALLS / MAX_FILES_READ), each
 * read's payload is capped by the provider, and the single summarization call to
 * the model is bounded by SCOUT.MAX_TOKENS. There is no open-ended tool loop —
 * the scout gathers a bounded sample, then makes one structured-output call to
 * turn that sample into areas, mirroring the single-bounded-call idiom of
 * interviewAgent.ts / triageAgent.ts / ticketAgent.ts.
 *
 * Server-side only — the Anthropic key is read through config and never exposed
 * to the frontend (§5.1, §17.3). The provider holds the repo credential; the
 * scout never sees or logs it (§5.3).
 *
 * The model summary is RE-VALIDATED at the boundary (§11.2) and the
 * "verify with engineering" flag is stamped TRUE structurally here, not left to
 * the model (spec Risk: findings are orientation, never certainty, §3.4).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SCOUT, requireAnthropicApiKey } from "../../config";
import { logger } from "../../config/logger";
import { CodeScoutError } from "../../controllers/codeScout/feature-utils/CodeScoutError";
import { scoutFindingsOutputSchema, scoutFindingsSchema } from "../../validation/codeScout";
import type { ScoutFindingsParsed } from "../../validation/codeScout";
import type { CodeContextProvider, CodeSearchHit } from "../../services/codeContext/CodeContextProvider";
import type { RepoRef, ScoutFindings } from "../../types/codeScout";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/** Inputs the scout needs to orient itself. */
export interface RunScoutParams {
  /** The PM's original request — what the scan is trying to orient. */
  originalRequest: string;
  /** The repo to scan, source-agnostic. */
  repo: RepoRef;
}

/**
 * A few short search queries derived from the request, capped at
 * MAX_SEARCH_CALLS. Coarse on purpose — the scout wants breadth (where in the
 * codebase is relevant), not a deep crawl. Named, not magic (§4.2).
 */
const BASE_QUERIES = ["function", "class", "service", "controller", "model", "route"];

const SYSTEM_PROMPT = [
  "You are a code scout for a product-ticket tool. A PM has a feature request and",
  "you have a BOUNDED sample of a real codebase: a list of file paths a few code",
  "searches matched, plus the contents of a few of those files. From only this",
  "sample, orient the PM to the codebase. Return:",
  "",
  "- summary: one short paragraph naming the parts of the codebase relevant to the",
  "  request, in plain language a PM understands.",
  "- relevantAreas: the FEW areas that matter (no more than the cap). For each:",
  "    area           - a short label (e.g. \"Authentication\").",
  "    whatExists     - what already exists there, in orientation terms.",
  "    roughSize      - a COARSE tier (XS|S|M|L|XL) for working in this area. Never hours.",
  "    whatItTouches  - adjacent areas / integrations / data it touches.",
  "    feasibility    - clear | likely | uncertain — your confidence it is relevant.",
  "    paths          - a few of the sampled file paths that back this area (pointers only).",
  "",
  "Rules:",
  "- ORIENTATION ONLY. Never write code-level or file-level implementation steps,",
  "  never a task list, never an engineering plan. That is engineering's job.",
  "- Keep it COARSE. Areas and rough sizes, not precise file claims.",
  "- Base every statement on the sample you were given. If the sample is thin, say so",
  "  and mark feasibility uncertain — do not invent areas that are not evidenced.",
].join("\n");

export class CodeScoutAgent {
  /**
   * Run one bounded scan and return structured, orientation-only findings.
   * Gathers a bounded sample via the provider (capped calls/files), then makes a
   * single structured-output summarization call (with model fallback). Throws a
   * typed CodeScoutError on an unusable model result so nothing off-schema is
   * ever persisted.
   */
  static async run(
    provider: CodeContextProvider,
    params: RunScoutParams,
  ): Promise<ScoutFindings> {
    const sample = await this.gatherBoundedSample(provider, params);
    const parsed = await this.summarizeWithFallback(params, sample);

    // Stamp the verify flag structurally — not a model choice (spec Risk, §3.4).
    return {
      summary: parsed.summary,
      relevantAreas: parsed.relevantAreas.slice(0, SCOUT.MAX_AREAS),
      verifyWithEngineering: true,
    };
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Gather a bounded sample of the repo: run up to MAX_SEARCH_CALLS searches,
   * collect a de-duplicated path list, then read up to MAX_FILES_READ of those
   * files (each capped at MAX_FILE_BYTES by the provider). A single failing
   * search/read is tolerated (logged, skipped) so one transient error does not
   * abort the whole scan — the scout degrades to a thinner sample, and the model
   * is told the sample may be thin.
   */
  private static async gatherBoundedSample(
    provider: CodeContextProvider,
    params: RunScoutParams,
  ): Promise<ScoutSample> {
    const queries = this.buildQueries(params.originalRequest);
    const hitsByPath = new Map<string, CodeSearchHit>();

    for (const query of queries) {
      try {
        const hits = await provider.searchCode(
          params.repo,
          query,
          SCOUT.MAX_SEARCH_HITS,
        );
        for (const hit of hits) {
          if (!hitsByPath.has(hit.path)) hitsByPath.set(hit.path, hit);
        }
      } catch (error) {
        // Tolerate a single failed search; the scan continues with what it has.
        logger.warn(
          { err: error, repoRef: params.repo.repoRef, query },
          "Scout search call failed; continuing with a thinner sample",
        );
      }
    }

    // Prefer central, source-like files: shallower paths (fewer "/") and code
    // extensions first, so the bounded read budget lands on the files that
    // orient best — not whatever happened to sort first.
    const ranked = [...hitsByPath.keys()].sort(
      (a, b) => this.pathScore(a) - this.pathScore(b),
    );
    const paths = ranked.slice(0, SCOUT.MAX_FILES_READ);
    const files: ScoutSampleFile[] = [];
    for (const path of paths) {
      try {
        const file = await provider.readFile(
          params.repo,
          path,
          SCOUT.MAX_FILE_BYTES,
        );
        files.push({ path: file.path, content: file.content });
      } catch (error) {
        logger.warn(
          { err: error, repoRef: params.repo.repoRef, path },
          "Scout file read failed; skipping this file",
        );
      }
    }

    logger.info(
      {
        repoRef: params.repo.repoRef,
        searches: queries.length,
        pathsFound: hitsByPath.size,
        filesRead: files.length,
      },
      "Scout gathered a bounded sample",
    );

    return { paths: ranked, files };
  }

  /**
   * Rank a path for read priority — LOWER is better. Shallower paths (fewer
   * segments) and recognized source/doc extensions rank first, so the bounded
   * read budget lands on central, high-signal files rather than deep fixtures.
   */
  private static pathScore(path: string): number {
    const depth = path.split("/").length;
    const isSourceLike = /\.(ts|tsx|js|jsx|py|go|rb|java|md)$/i.test(path);
    return depth * 2 + (isSourceLike ? 0 : 5);
  }

  /**
   * Build the bounded query list: a few terms from the request plus the generic
   * structural terms, deduplicated and capped at MAX_SEARCH_CALLS. The LAST slot
   * is reserved for a broad catch-all (empty string), which matches every path —
   * so even when no specific term hits a path, the scout still surfaces the
   * repo's central files (ranked by pathScore) rather than reading nothing.
   * Coarse breadth over depth.
   */
  private static buildQueries(originalRequest: string): string[] {
    const requestTerms = originalRequest
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4);

    const seen = new Set<string>();
    const queries: string[] = [];
    // Reserve one slot for the broad catch-all so it always runs (added below).
    const specificBudget = Math.max(1, SCOUT.MAX_SEARCH_CALLS - 1);
    for (const term of [...requestTerms, ...BASE_QUERIES]) {
      if (queries.length >= specificBudget) break;
      if (seen.has(term)) continue;
      seen.add(term);
      queries.push(term);
    }
    // Broad catch-all: matches all paths (substring of ""), surfacing central
    // files when specific terms missed. Ranked/capped downstream by pathScore.
    queries.push("");
    return queries;
  }

  /**
   * The single structured-output summarization call, with a one-shot fallback to
   * the secondary model on a primary rejection (mirrors the other agents). The
   * parsed output is re-validated at the boundary; an unusable result throws a
   * typed CodeScoutError so it is never persisted (§11.2, spec Risk).
   */
  private static async summarizeWithFallback(
    params: RunScoutParams,
    sample: ScoutSample,
  ): Promise<ScoutFindingsParsedShape> {
    const userPrompt = this.buildUserPrompt(params, sample);
    let raw: unknown;
    try {
      raw = await this.callModel(userPrompt, SCOUT.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, repoRef: params.repo.repoRef, model: SCOUT.MODEL },
        "Scout primary model failed; retrying with fallback",
      );
      try {
        raw = await this.callModel(userPrompt, SCOUT.FALLBACK_MODEL);
      } catch {
        throw new CodeScoutError(
          "SCOUT_GENERATION_FAILED",
          "The code scout could not summarize the codebase.",
          { repoRef: params.repo.repoRef },
        );
      }
    }
    return this.parseOrThrow(raw, params.repo.repoRef);
  }

  /** One bounded structured-output call against the given model id. */
  private static async callModel(userPrompt: string, model: string): Promise<unknown> {
    const message = await getClient().messages.parse({
      model,
      max_tokens: SCOUT.MAX_TOKENS,
      // Adaptive thinking + MEDIUM effort: synthesis into areas, still bounded (spec Constraints).
      thinking: { type: "adaptive" },
      output_config: {
        effort: SCOUT.EFFORT,
        format: zodOutputFormat(scoutFindingsOutputSchema),
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (message.parsed_output === null) {
      logger.warn(
        { stopReason: message.stop_reason, model },
        "Scout agent returned no parseable summary",
      );
    }
    return message.parsed_output;
  }

  /** Re-validate the model output at the boundary; throw on failure (§11.2). */
  private static parseOrThrow(raw: unknown, repoRef: string): ScoutFindingsParsedShape {
    const parsed = scoutFindingsSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { repoRef, issues: parsed.error.issues.map((i) => i.message) },
        "Scout summary failed boundary validation; rejecting",
      );
      throw new CodeScoutError(
        "SCOUT_GENERATION_INVALID",
        "The code scout returned malformed findings.",
        { repoRef },
      );
    }
    return parsed.data;
  }

  /**
   * Build the user prompt from the bounded sample: the request, the matched paths,
   * and the (capped) file contents. If the sample is thin, the prompt says so so
   * the model marks feasibility uncertain rather than inventing areas.
   */
  private static buildUserPrompt(params: RunScoutParams, sample: ScoutSample): string {
    const pathLines =
      sample.paths.length === 0
        ? "(no files matched the searches — the sample is empty)"
        : sample.paths.map((p) => `- ${p}`).join("\n");

    const fileBlocks =
      sample.files.length === 0
        ? "(no file contents were read)"
        : sample.files
            .map((f) => `FILE: ${f.path}\n---\n${f.content}\n---`)
            .join("\n\n");

    return [
      `Original request:\n${params.originalRequest}`,
      "",
      `Repo: ${params.repo.provider}:${params.repo.repoRef}`,
      "",
      `Matched file paths (bounded sample):\n${pathLines}`,
      "",
      `Sampled file contents (capped):\n${fileBlocks}`,
      "",
      `Return at most ${SCOUT.MAX_AREAS} relevant areas. Orientation only.`,
    ].join("\n");
  }
}

/** The parsed model summary shape (before the verify flag is stamped). */
type ScoutFindingsParsedShape = ScoutFindingsParsed;

/** A file in the bounded sample. */
interface ScoutSampleFile {
  path: string;
  content: string;
}

/** The bounded sample the scout gathered before summarizing. */
interface ScoutSample {
  paths: string[];
  files: ScoutSampleFile[];
}
