/**
 * TitleService — generates a concise session title from either the original
 * request or a finalized ticket (User QA: auto-generated session title, §6.3,
 * §7.1). The only layer between a caller and the title agent; calls the agent
 * with model fallback, re-validates at the boundary (§11.2), and sanitizes the
 * result into the persisted shape. Never touches req/res. Mirrors TriageService
 * (the other LOW-effort, degrade-don't-fail agent service, §6.1).
 *
 * Failure policy: a title is NEVER a hard gate. The generator degrades to null
 * (no title) whenever the model is unsure, returns off-schema output, or fails
 * outright (after a fallback-model retry). A title ride-along can therefore never
 * fail the session create or the ticket finalize it is attached to (§3.1: every
 * async call is wrapped). The caller persists null and the dashboard falls back
 * to the request snippet.
 */
import { generateTitle, sanitizeTitle } from "../../../agents/titleAgent";
import type { TitleSource } from "../../../agents/titleAgent";
import { TITLE_GENERATION } from "../../../config";
import { logger } from "../../../config/logger";
import { generatedTitleSchema } from "../../../validation/title";

export class TitleService {
  /**
   * Generate a sanitized title for the given source, or null on any failure.
   * Owns the whole degrade-don't-fail flow so both call sites (create, finalize)
   * stay thin and identical. `context` is logged for traceability (§9.3) — the
   * session id, never any secret.
   */
  static async generate(
    source: TitleSource,
    context: { sessionId?: number } = {},
  ): Promise<string | null> {
    const raw = await this.callAgentWithFallback(source, context);
    if (raw === null) return null;
    return this.parseAndSanitize(raw, context);
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Call the agent; on a model-rejection error, retry once with the fallback
   * model (mirrors the triage/ticket fallback). Any hard failure on both models
   * degrades to null rather than throwing — a title never fails its host op.
   */
  private static async callAgentWithFallback(
    source: TitleSource,
    context: { sessionId?: number },
  ): Promise<unknown> {
    try {
      return await generateTitle(source, TITLE_GENERATION.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, ...context, model: TITLE_GENERATION.MODEL },
        "Primary model failed; retrying title generation with fallback",
      );
      try {
        return await generateTitle(source, TITLE_GENERATION.FALLBACK_MODEL);
      } catch (fallbackError) {
        logger.warn(
          { err: fallbackError, ...context },
          "Title generation failed on both models; persisting no title",
        );
        return null;
      }
    }
  }

  /**
   * Re-validate the model output at the boundary (§11.2), then sanitize it into
   * the persisted shape. An off-schema result, or one that sanitizes to nothing
   * usable, degrades to null (no title) — the title is never trusted raw.
   */
  private static parseAndSanitize(
    raw: unknown,
    context: { sessionId?: number },
  ): string | null {
    const parsed = generatedTitleSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { ...context, issues: parsed.error.issues.map((i) => i.message) },
        "Generated title was off-schema; persisting no title",
      );
      return null;
    }
    const clean = sanitizeTitle(parsed.data.title);
    if (clean === null) {
      logger.warn({ ...context }, "Generated title was empty after sanitizing; persisting no title");
    }
    return clean;
  }
}
