/**
 * Triage agent — the seam to the Anthropic SDK for request classification (§6.2).
 * Makes one cheap, bounded, structured-output call: given the PM's original
 * request, it returns a label — `simple` or `scoped` — plus a one-line reason
 * as validated JSON (spec T1). Server-side only — the API key is read through
 * config and never exposed to the frontend (§5.1, §17.3). Mirrors
 * agents/interviewAgent.ts and agents/ticketAgent.ts.
 *
 * Cost/latency controls (spec Constraints, Risk: triage adds a call to every
 * request): adaptive thinking at LOW effort, a tight max_tokens, and a single
 * short-lived call (not a loop), so the extra call stays cheap and fast.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TRIAGE, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { triageClassificationOutputSchema } from "../validation/triage";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/** The single input the classifier needs. */
export interface ClassifyRequestParams {
  originalRequest: string;
}

const SYSTEM_PROMPT = [
  "You are a triage classifier for a product-ticket tool. A PM submits a feature",
  "request and you decide how much process it needs. Return exactly one label:",
  "",
  '- "simple": a small, well-understood ask that needs little or no clarification —',
  "  a bug fix, a copy/text change, a config tweak, a single obvious field, a",
  "  one-line behavior change. A good ticket can be drafted from the request",
  "  almost as-is, with at most one clarifying question.",
  '- "scoped": genuinely ambiguous or multi-decision work — a new feature, a flow',
  "  with several open product decisions, anything where reasonable people would",
  "  need an interview to pin down requirements.",
  "",
  "Rules:",
  "- When you are unsure, or the request is vague, or it could plausibly go either",
  '  way, choose "scoped". Defaulting to scoped is correct: the cost of an',
  "  unneeded interview is small; the cost of a thin ticket from real scope is high.",
  "- Judge the WORK the request implies, not its wording length. A short sentence",
  "  can still describe a large, ambiguous feature.",
  "- reason is one short sentence explaining the call.",
].join("\n");

function buildUserPrompt(params: ClassifyRequestParams): string {
  return [`Original request:\n${params.originalRequest}`, "", "Classify it now."].join(
    "\n",
  );
}

/**
 * Classify a request via a single structured-output call. The model id is the
 * effective one (primary, or the caller-provided fallback after a rejection).
 * Returns the raw parsed object; the caller re-validates at the boundary (§11.2)
 * and defaults to `scoped` on anything unusable. Errors propagate to the
 * service, which retries with the fallback model and ultimately defaults to
 * scoped rather than failing the request (spec Risk).
 */
export async function classifyRequest(
  params: ClassifyRequestParams,
  model: string = TRIAGE.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: TRIAGE.MAX_TOKENS,
    // Adaptive thinking + LOW effort: a cheap, short classification call (spec Constraints).
    thinking: { type: "adaptive" },
    output_config: {
      effort: TRIAGE.EFFORT,
      format: zodOutputFormat(triageClassificationOutputSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(params) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Triage agent returned no parseable classification",
    );
  }
  // Return raw; the service re-validates and defaults to scoped if unusable.
  return message.parsed_output;
}
