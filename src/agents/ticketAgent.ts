/**
 * Ticket agent — the seam to the Anthropic SDK for ticket generation (§6.2).
 * Makes one bounded, structured-output call: given the original request plus the
 * session's recorded decisions, it returns a ticket as validated JSON — a user
 * story (As a / I want / So that), an array of Given/When/Then acceptance
 * criteria, an effort TIER (never hours), and a short context summary (spec T1).
 * Server-side only — the API key is read through config and never exposed to the
 * frontend (§5.1, §17.3). Mirrors agents/interviewAgent.ts.
 *
 * Cost/latency controls (spec Constraints): adaptive thinking at MEDIUM effort, a
 * bounded max_tokens, and a single short-lived call (not a long agent loop), so
 * no HTTP request runs long under serverless timeouts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TICKET_GENERATION, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { generatedTicketOutputSchema } from "../validation/ticket";
import type { IDecisionRecord } from "../types/interview";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/** Inputs the agent needs to synthesize a ticket. */
export interface GenerateTicketParams {
  originalRequest: string;
  /** The structured decisions recorded during the interview (the real source of truth). */
  decisions: IDecisionRecord[];
}

const EFFORT_TIER_GUIDANCE = [
  "Effort is a COMPLEXITY TIER, never a count of hours or days. Choose exactly one:",
  "- XS: trivial, isolated change.",
  "- S: small, well-understood change in one area.",
  "- M: a moderate feature touching a few areas.",
  "- L: a large feature spanning several areas or with notable unknowns.",
  "- XL: a major effort with significant unknowns or cross-cutting impact.",
  "Never emit a time estimate; engineering verifies the tier.",
].join("\n");

const SYSTEM_PROMPT = [
  "You are a product manager turning a set of settled product decisions into a",
  "single, durable engineering ticket. Produce a consistent, hand-off-ready ticket.",
  "",
  "Rules:",
  "- user_story MUST be one sentence in exactly this form:",
  '  "As a {role}, I want {capability}, So that {benefit}".',
  "- acceptance_criteria is an array of Given/When/Then blocks. Each block has a",
  "  concrete given (precondition), when (action), and then (observable outcome).",
  "  Write at least two criteria covering the main behavior and an edge/failure case",
  "  when the decisions imply one.",
  "- Ground every field in the recorded decisions and the original request. Do not",
  "  invent requirements that were not decided; prefer the decisions over the vague",
  "  original request where they conflict.",
  "- context_summary is 1-3 sentences a developer reads first: what this is and why.",
  "",
  EFFORT_TIER_GUIDANCE,
].join("\n");

function buildUserPrompt(params: GenerateTicketParams): string {
  const decisionLines =
    params.decisions.length === 0
      ? "(no recorded decisions — derive the ticket from the original request alone)"
      : params.decisions
          .map((d) => `- ${d.key}: ${JSON.stringify(d.value)} [source: ${d.source}]`)
          .join("\n");

  return [
    `Original request:\n${params.originalRequest}`,
    "",
    `Settled decisions:\n${decisionLines}`,
    "",
    "Produce the ticket now as structured output.",
  ].join("\n");
}

/**
 * Generate a ticket via a single structured-output call. The model id is the
 * effective one (primary, or the caller-provided fallback after a rejection).
 * Returns the raw parsed object; the caller re-validates at the boundary (§11.2)
 * before persisting. Errors propagate to the service, which maps them to a typed
 * TicketError.
 */
export async function generateTicket(
  params: GenerateTicketParams,
  model: string = TICKET_GENERATION.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: TICKET_GENERATION.MAX_TOKENS,
    // Adaptive thinking + MEDIUM effort: bounded synthesis call (spec Constraints).
    thinking: { type: "adaptive" },
    output_config: {
      effort: TICKET_GENERATION.EFFORT,
      format: zodOutputFormat(generatedTicketOutputSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(params) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Ticket agent returned no parseable ticket",
    );
  }
  // Return raw; the service re-validates with the boundary schema.
  return message.parsed_output;
}
