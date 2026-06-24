/**
 * Bit proposal agent — the seam to the Anthropic SDK for merge-on-complete
 * (spec T13, §6.2). Makes one bounded, structured-output call: given a FINALIZED
 * ticket (its user story, acceptance criteria, context summary, effort tier) plus
 * the session's settled decisions, it returns 1-4 CANDIDATE bits capturing the
 * DURABLE facts the completed feature establishes about the app — not a restate
 * of the ticket, but what is now true of the product. Server-side only — the API
 * key is read through config and never exposed to the frontend (§5.1, §17.3).
 * Mirrors agents/ticketAgent.ts and agents/bitReconciliationAgent.ts (the bounded
 * one-call shape: lazy SDK singleton, messages.parse + zodOutputFormat, model
 * default + fallback, static system prompt + per-call user prompt builders).
 *
 * The agent PROPOSES; the human DISPOSES (spec R2). It never writes; it returns
 * candidates the service re-validates at the boundary (bitProposalOutputSchema,
 * §11.2) and then runs through the reconciliation agent → a plan the PM resolves.
 * So a loose or over-eager proposal can never silently land in the project's
 * context — every candidate passes dedup/merge reconciliation and a human resolve
 * before it is stamped.
 *
 * Cost/latency controls: adaptive thinking at MEDIUM effort and a tight
 * max_tokens (a few short bits), so the single short-lived call never runs long
 * under a serverless timeout (spec Risk).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The SDK's zodOutputFormat targets the `zod/v4` surface (same constraint the
// interview/ticket/reconciliation agents honor); the boundary re-validation in
// the service uses the plain-`zod` bitProposalOutputSchema. Keep this output
// schema to the structured-output-safe subset (no min/max bounds — the SDK
// strips them); the boundary schema enforces the 1-4 count.
import * as zv4 from "zod/v4";
import { BIT_PROPOSAL, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { BIT_KINDS } from "../validation/projectBit";
import { SETTLED_BIT_KINDS } from "../types/project";
import type { AcceptanceCriterion, EffortTier, IDecisionRecord } from "../types/interview";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/**
 * Inputs the agent needs to propose bits from a finalized ticket (spec T13). The
 * ticket fields are the finalized content; `decisions` are the session's settled
 * decisions (the real source of truth behind the ticket). All loaded/validated by
 * the caller (BitReconciliationService); nothing is queried here.
 */
export interface GenerateBitProposalParams {
  userStory: string;
  acceptanceCriteria: AcceptanceCriterion[];
  contextSummary: string;
  effort: EffortTier;
  decisions: IDecisionRecord[];
}

/**
 * The model-facing structured-output schema (zod/v4 for zodOutputFormat). The
 * service re-validates the parsed result with the plain-`zod`
 * bitProposalOutputSchema at the boundary before trusting it (§11.2), so this
 * schema only has to constrain the model's shape — the 1-4 count is enforced by
 * the boundary schema, not here (the SDK strips min/max bounds).
 */
const bitProposalOutputFormat = zv4.object({
  bits: zv4.array(
    zv4.object({
      /** One of the five bit kinds (feature/constraint/integration/tech_stack/inventory). */
      kind: zv4.enum(BIT_KINDS),
      /** A short snake_case label for the fact (cosmetic — dedup is semantic). */
      bit_key: zv4.string(),
      /** A single durable sentence about the app this completed feature establishes. */
      summary: zv4.string(),
    }),
  ),
});

/**
 * System prompt — the proposal rules baked in (spec T13). Static across calls
 * (the per-call ticket + decisions go in the user message), mirroring how the
 * ticket/reconciliation agents keep their rules in a constant. The kinds and the
 * settled subset are named from the shared BIT_KINDS / SETTLED_BIT_KINDS
 * constants so the agent, the engine, the reconciler, and tests share one source
 * of truth (§4.2).
 */
const SYSTEM_PROMPT = [
  "You are a project-context curator. A feature has just been finalized as an",
  "engineering ticket. Your job is to distill the DURABLE facts this completed",
  "feature establishes about the application into a few typed 'bits' — short",
  "key->summary facts that will ground future product interviews and tickets.",
  "",
  "Propose 1 to 4 bits. Fewer is better: capture only what is now TRUE of the app",
  "and worth remembering, not a play-by-play of the ticket. A bit is a lasting",
  "property of the product, not a task that was done. Prefer one well-chosen bit",
  "over four thin ones.",
  "",
  "Each bit has:",
  "- kind: exactly one of the five kinds.",
  `    Settled kinds (${SETTLED_BIT_KINDS.join(", ")}) are hard facts that can later`,
  "    suppress an interview question; the rest (feature, integration) describe",
  "    capabilities and external systems that flavor options. Choose the kind that",
  "    matches the fact: a new capability is `feature`; a hard limit or decision is",
  "    `constraint`; an external system is `integration`; what it is built with is",
  "    `tech_stack`; a concrete thing that now exists (a screen, a route, an entity)",
  "    is `inventory`.",
  "- bit_key: a short snake_case label (e.g. `auth_method`, `sms_provider`). It is a",
  "    cosmetic label only; reconciliation matches by meaning, not by key.",
  "- summary: ONE sentence stating the durable fact in product terms (what the app",
  "    now does / supports / is built with), readable without the ticket.",
  "",
  "Ground every bit in the finalized ticket and the settled decisions; do not invent",
  "facts that were not decided. If the feature establishes nothing durable beyond the",
  "obvious, return a single best bit rather than padding to four. Never use em-dashes",
  "or en-dashes; use commas, periods, parentheses, or hyphens.",
].join("\n");

/** Render the session's settled decisions as a compact key: value list. */
function buildDecisionsBlock(decisions: IDecisionRecord[]): string {
  if (decisions.length === 0) {
    return "Settled decisions: (none recorded — derive the bits from the ticket alone).";
  }
  const lines = decisions.map(
    (decision) => `- ${decision.key}: ${JSON.stringify(decision.value)} [source: ${decision.source}]`,
  );
  return ["Settled decisions:", ...lines].join("\n");
}

/** Render the ticket's acceptance criteria as a compact Given/When/Then list. */
function buildCriteriaBlock(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "Acceptance criteria: (none).";
  const lines = criteria.map(
    (criterion) => `- Given ${criterion.given}; When ${criterion.when}; Then ${criterion.then}`,
  );
  return ["Acceptance criteria:", ...lines].join("\n");
}

function buildUserPrompt(params: GenerateBitProposalParams): string {
  return [
    "A feature was just finalized. Propose the durable project-context bits it",
    "establishes, as structured output.",
    "",
    `Finalized ticket:`,
    `User story: ${params.userStory}`,
    `Context summary: ${params.contextSummary}`,
    `Effort tier: ${params.effort}`,
    "",
    buildCriteriaBlock(params.acceptanceCriteria),
    "",
    buildDecisionsBlock(params.decisions),
    "",
    "Return 1 to 4 bits now.",
  ].join("\n");
}

/**
 * Generate candidate bits from a finalized ticket via a single structured-output
 * call. The model id is the effective one (primary, or the caller-provided
 * fallback after a rejection). Returns the RAW parsed object; the caller
 * (BitReconciliationService.proposeFromTicket) re-validates it against
 * bitProposalOutputSchema at the boundary (§11.2) before trusting or reconciling
 * any candidate. Errors propagate to the service, which maps them to a typed
 * error and retries with the fallback model once.
 */
export async function generateBitProposal(
  params: GenerateBitProposalParams,
  model: string = BIT_PROPOSAL.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: BIT_PROPOSAL.MAX_TOKENS,
    // Adaptive thinking + MEDIUM effort: bounded ticket-to-bits synthesis (spec T13).
    thinking: { type: "adaptive" },
    output_config: {
      effort: BIT_PROPOSAL.EFFORT,
      format: zodOutputFormat(bitProposalOutputFormat),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(params) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Bit proposal agent returned no parseable proposal",
    );
  }
  // Return raw; the service re-validates with the boundary schema (§11.2).
  return message.parsed_output;
}
