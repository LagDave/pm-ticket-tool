/**
 * Ticket agent — the seam to the Anthropic SDK for ticket generation (§6.2).
 * Makes one bounded, structured-output call: given the original request, the
 * session's recorded decisions, and (when the session is attached to a project)
 * its bits as orientation, it returns a ticket as validated JSON — the core fields
 * (user story, Given/When/Then criteria, effort TIER, context) plus the enrichment
 * that keeps the PM's answers visible (priority tier, problem/background, key
 * decisions, open questions, success metrics, dependencies, codebase grounding —
 * spec What). The project bits ground the ticket (and are the only source for its
 * codebase_grounding section); the decisions remain the source of truth. Server-
 * side only: the API key is read through config and never exposed to the frontend
 * (§5.1, §17.3). Mirrors agents/interviewAgent.ts.
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
import type { ProjectGrounding } from "../types/project";
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
  /**
   * The session's project-bits grounding (project context), when the session is
   * attached to a project with active bits. ORIENTATION ONLY — it makes the ticket
   * concrete against the real app and is the only source for the codebase_grounding
   * section, but the decisions remain the source of truth and the model must not
   * invent requirements they did not settle. Absent (undefined) leaves generation
   * ungrounded (an empty codebase_grounding). A single call, so no prompt caching.
   */
  grounding?: ProjectGrounding;
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

const PRIORITY_TIER_GUIDANCE = [
  "Priority is an IMPACT TIER, never a number. Choose exactly one:",
  "- high: urgent or blocking, with clear near-term business impact.",
  "- medium: valuable but not blocking. The default when unsure.",
  "- low: nice-to-have or deferrable.",
  "The team confirms priority; do not overstate it.",
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
  "- If a 'Project context' block is present, use it as ORIENTATION about the existing",
  "  app (what already exists, the stack, integrations, constraints) to make the ticket",
  "  concrete — but never add requirements it implies that the decisions did not settle.",
  "- problem_background is a short paragraph: the business reason behind the request",
  "  (who is hurting and why), distinct from the developer-facing context_summary.",
  "- key_decisions surfaces the settled decisions in the PM's terms: each has a short",
  "  label and an optional one-line detail. Derive them from the recorded decisions;",
  "  use an empty string for detail when there is nothing to add.",
  "- open_questions lists assumptions made or questions still unresolved. Empty array",
  "  when there are none — do not manufacture questions.",
  "- success_metrics lists observable signals the feature worked. Empty array when",
  "  the decisions imply none.",
  "- dependencies lists prerequisites or blockers this work relies on. Empty when none.",
  "- codebase_grounding maps the work to the app areas the Project context describes:",
  "  each item has an area (a feature/module/topic from the bits) and a note (why it",
  "  matters). Use ONLY the provided Project context. If no Project context is",
  "  provided, return an empty array and never invent areas or file paths.",
  "- Never use em-dashes (—) or en-dashes (–) in any output. Use commas, periods,",
  "  parentheses, or hyphens instead.",
  "",
  EFFORT_TIER_GUIDANCE,
  "",
  PRIORITY_TIER_GUIDANCE,
].join("\n");

/** Render project bits as orientation context for the ticket (never new requirements). */
function buildProjectContextBlock(grounding: ProjectGrounding): string {
  const lines = grounding.bits.map(
    (bit) => `- [${bit.kind}] (${bit.bit_key}) ${bit.summary}`,
  );
  return [
    `Project context for "${grounding.projectName}" (orientation only — do not invent requirements beyond the decisions):`,
    ...lines,
  ].join("\n");
}

function buildUserPrompt(params: GenerateTicketParams): string {
  const decisionLines =
    params.decisions.length === 0
      ? "(no recorded decisions — derive the ticket from the original request alone)"
      : params.decisions
          .map((d) => `- ${d.key}: ${JSON.stringify(d.value)} [source: ${d.source}]`)
          .join("\n");

  const lines = [
    `Original request:\n${params.originalRequest}`,
    "",
    `Settled decisions:\n${decisionLines}`,
  ];
  if (params.grounding) {
    lines.push("", buildProjectContextBlock(params.grounding));
  }
  lines.push("", "Produce the ticket now as structured output.");
  return lines.join("\n");
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
