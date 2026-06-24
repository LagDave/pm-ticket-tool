/**
 * Title agent — the seam to the Anthropic SDK for session-title generation
 * (§6.2, User QA: auto-generated session title). Makes one cheap, bounded,
 * structured-output call: given either the PM's original request OR a finalized
 * ticket, it returns a concise display title as validated JSON. Server-side only
 * — the API key is read through config and never exposed to the frontend (§5.1,
 * §17.3). Mirrors agents/triageAgent.ts (the other LOW-effort agent).
 *
 * Cost/latency controls (the title rides on session create + ticket finalize, so
 * it must stay cheap): adaptive thinking at LOW effort, a tight max_tokens, and a
 * single short-lived call (not a loop). A title is a label, not synthesis, so it
 * gets the least reasoning budget.
 *
 * Output discipline: the prompt asks for max ~8 words, sentence case, no
 * surrounding quotes, and NO em-dashes/en-dashes (Feature 2). The service also
 * sanitizes the result (sanitizeTitle) so a disobedient model can never persist
 * quotes, dashes, or an over-long title — the cleanup is structural, not a hope.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TITLE_GENERATION, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import {
  TITLE_MAX_LENGTH,
  TITLE_MAX_WORDS,
  generatedTitleOutputSchema,
} from "../validation/title";
import type { AcceptanceCriterion, EffortTier } from "../types/interview";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/**
 * The two title sources (User QA). A title is generated TWICE in a session's
 * life: once from the raw request at create, then replaced from the finalized
 * ticket. Both flow through the same agent via this tagged input.
 */
export type TitleSource =
  | { kind: "request"; originalRequest: string }
  | {
      kind: "ticket";
      userStory: string;
      contextSummary: string;
      acceptanceCriteria: AcceptanceCriterion[];
      effort: EffortTier;
    };

const SYSTEM_PROMPT = [
  "You write a single concise title for a product-engineering work item. The PM",
  "will see this title as the item's label on a dashboard, so it must read like a",
  "short headline a human wrote.",
  "",
  "Rules:",
  `- At most ${TITLE_MAX_WORDS} words. Shorter is better. Never a full sentence.`,
  "- Sentence case: capitalize the first word and any proper nouns only. Do NOT",
  "  Title-Case Every Word.",
  "- Name the WORK, not the process. Prefer a verb-led phrase (e.g. 'Add magic-link",
  "  login', 'Fix dashboard pagination'), not 'A request to ...' or 'Ticket for ...'.",
  "- No trailing punctuation. No surrounding quotes of any kind.",
  "- Never use em-dashes (—) or en-dashes (–) in any output. Use commas, periods,",
  "  parentheses, or hyphens instead.",
].join("\n");

/** Render the two acceptance criteria most useful for a title (kept tiny on purpose). */
function summarizeCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(none)";
  return criteria
    .slice(0, 2)
    .map((c) => `when ${c.when}, then ${c.then}`)
    .join("; ");
}

function buildUserPrompt(source: TitleSource): string {
  if (source.kind === "request") {
    return [
      "Write the title from this raw feature request:",
      source.originalRequest,
      "",
      "Return the title now.",
    ].join("\n");
  }
  return [
    "Write the title from this finalized engineering ticket:",
    `User story: ${source.userStory}`,
    `Context: ${source.contextSummary}`,
    `Effort tier: ${source.effort}`,
    `Acceptance criteria: ${summarizeCriteria(source.acceptanceCriteria)}`,
    "",
    "Return the title now.",
  ].join("\n");
}

/**
 * Clean a model-produced title into the persisted shape, structurally (never
 * trusting the model to obey the prompt). Strips surrounding quotes, replaces any
 * em-dash/en-dash with a comma+space (Feature 2: no em-dashes in user-facing
 * strings), collapses whitespace, caps to TITLE_MAX_WORDS words, then enforces
 * the TITLE_MAX_LENGTH character backstop. Returns null when nothing usable
 * remains, so the caller persists "no title" rather than an empty/garbage label.
 */
export function sanitizeTitle(raw: string): string | null {
  let text = raw.trim();
  // Strip a single pair of surrounding quotes (straight or curly) if present.
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  // Replace em-dashes / en-dashes with a comma so no dash survives (Feature 2).
  text = text.replace(/\s*[—–]\s*/g, ", ");
  // Collapse internal whitespace/newlines to single spaces.
  text = text.replace(/\s+/g, " ").trim();
  // Drop a single trailing sentence-ending punctuation mark.
  text = text.replace(/[.,;:]+$/g, "").trim();
  if (text.length === 0) return null;

  // Cap to the word target, then to the hard character backstop.
  const words = text.split(" ");
  if (words.length > TITLE_MAX_WORDS) {
    text = words.slice(0, TITLE_MAX_WORDS).join(" ");
  }
  if (text.length > TITLE_MAX_LENGTH) {
    text = text.slice(0, TITLE_MAX_LENGTH).trim();
  }
  return text.length > 0 ? text : null;
}

/**
 * Generate a concise title via a single structured-output call. The model id is
 * the effective one (primary, or the caller-provided fallback after a rejection).
 * Returns the raw parsed object; the caller re-validates at the boundary (§11.2)
 * and sanitizes. Errors propagate to the service, which retries with the fallback
 * model and ultimately persists "no title" rather than failing the create/finalize.
 */
export async function generateTitle(
  source: TitleSource,
  model: string = TITLE_GENERATION.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: TITLE_GENERATION.MAX_TOKENS,
    // Adaptive thinking + LOW effort: a cheap, short labeling call (§4.2 config).
    thinking: { type: "adaptive" },
    output_config: {
      effort: TITLE_GENERATION.EFFORT,
      format: zodOutputFormat(generatedTitleOutputSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(source) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Title agent returned no parseable title",
    );
  }
  // Return raw; the service re-validates and sanitizes, defaulting to no title.
  return message.parsed_output;
}
