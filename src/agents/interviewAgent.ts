/**
 * Interview agent — the ONLY place the Anthropic SDK is constructed for the
 * interview (§6.2). Makes one bounded, structured-output call per batch: given the
 * original request plus prior decisions, it returns up to four dependency-ordered
 * questions as validated JSON. Server-side only — the API key is read through
 * config and never exposed to the frontend (§5.1, §17.3).
 *
 * Grounding (project bits, replacing the removed code scout): when the session is
 * attached to a project with active bits, the engine passes them as `grounding`.
 * The bits render into a CACHED system block (cache_control) so batch 2+ of an
 * interview read the stable rules+bits prefix from cache (spec R4); the per-call
 * data (decisions, round, request) stays in the user message and is never part of
 * that prefix. SETTLED-kind bits (constraint/tech_stack/inventory) may SUPPRESS a
 * question; feature/integration bits only ground options (spec R3).
 *
 * Cost/latency controls: adaptive thinking at LOW effort, a bounded max_tokens, and
 * a single short-lived call per turn, so no HTTP request runs long under serverless
 * timeouts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { INTERVIEW_ENGINE, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { generatedBatchOutputSchema } from "../validation/interviewQuestions";
import { SETTLED_BIT_KINDS } from "../types/project";
import type { BitKind, IProjectBit, ProjectGrounding } from "../types/project";
import type { IDecisionRecord } from "../types/interview";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/** Inputs the agent needs to generate the next batch. */
export interface GenerateBatchParams {
  originalRequest: string;
  /** Decisions already recorded — the model must not re-ask these. */
  priorDecisions: IDecisionRecord[];
  /** 1-based round number, surfaced to the model so it can wind down near the cap. */
  roundNumber: number;
  maxRounds: number;
  maxQuestions: number;
  /**
   * The session's project-bits grounding (spec: project context). When present,
   * options are GROUNDED in these bits (groundingRef) and questions a SETTLED bit
   * fully determines are suppressed. Absent (undefined) on the no-project / no-bits
   * fallback — generation then produces ungrounded options (no groundingRef, nothing
   * suppressed) but still with a speed tier and one recommended pick. Loaded by the
   * engine; never queried here.
   */
  grounding?: ProjectGrounding;
}

/**
 * Base interviewer rules — shared by the grounded and ungrounded paths so the
 * no-grounding path is unchanged from before grounding existed. Option-shape rules
 * differ by path and are appended below.
 */
const BASE_RULES = [
  "You are a product-requirements interviewer. A PM gives a vague request and",
  "you turn it into complete, consistent requirements through a short, adaptive",
  "interview. Generate the NEXT batch of dependency-ordered questions.",
  "",
  "Rules:",
  "- Ask only questions whose answers would materially change the resulting ticket.",
  "- Never re-ask anything already settled in the prior decisions.",
  "- Order questions by dependency: a question that depends on another comes after it,",
  "  and lists the earlier question's id in dependsOn.",
  "- Each question carries a stable decisionKey (snake_case) used to record the answer.",
  "- Provide 2-5 concrete answer options per question; set allowOther true when a",
  "  free-text answer is reasonable.",
  "- Set hasOpenMaterialDecisions false when, after this batch is answered, you expect",
  "  no further material decisions remain — i.e. the interview can terminate.",
  "- You are near the hard round cap; prefer fewer, higher-value questions and wind down.",
];

/**
 * The ordered build-speed scale every option carries. 5 steps, slowest→fastest,
 * where `fastest` = LEAST build effort and `slowest` = MOST. The map is the prompt's
 * source of truth for what each step means; it mirrors the SPEED_TIERS enum in
 * validation/interviewQuestions.ts.
 */
const SPEED_DESCRIPTIONS: Record<string, string> = {
  slowest: "most work to build (largest effort)",
  slow: "more work than average to build",
  moderate: "a middling amount of work to build",
  fast: "less work than average to build",
  fastest: "least work to build (smallest effort)",
};

/** The speed scale, rendered as an ordered slowest→fastest line for the prompt. */
const SPEED_SCALE_LINE = ["slowest", "slow", "moderate", "fast", "fastest"]
  .map((tier) => `${tier} (${SPEED_DESCRIPTIONS[tier]})`)
  .join(" < ");

/**
 * Rules shared by BOTH option paths: every option carries a build-speed tier on the
 * ordered scale, and exactly one option per question is the single best pick
 * (recommended). These hold whether or not the session has grounding.
 */
const COMMON_OPTION_RULES = [
  "- Every option carries a `speed`: an ordered build-SPEED tier — one of",
  `  ${SPEED_SCALE_LINE}. The scale runs slowest → fastest, where FASTEST means the`,
  "  LEAST build effort and SLOWEST the most. Assign the tier that best reflects how much",
  "  work that option is to build. This is a build-speed indicator, not an hour estimate.",
  "- Mark EXACTLY ONE option per question `recommended: true` — the single best option —",
  "  and set `recommended: false` on every other option. Never mark zero, never mark two.",
];

/**
 * Ungrounded option rules (no project / no bits): no grounding and nothing is
 * suppressed, but options still get a `speed` tier and exactly one `recommended`
 * pick (the common rules above). The no-grounding fallback stays explicit.
 */
const UNGROUNDED_OPTION_RULES = [
  "- This session has NO project context. Leave every option's groundingRef null and",
  "  return skipped as null — there is nothing to ground against or suppress on. Still",
  "  assign each option a `speed` tier and mark exactly one option `recommended` per the",
  "  rules above.",
];

/**
 * Grounded option rules (project bits present, rendered in the system block below).
 * Options derive from bits (groundingRef), and questions a SETTLED bit fully
 * determines are suppressed (recorded in skipped). The current-state-not-a-ceiling
 * framing prevents the bits from blocking an option the request is asking to add.
 */
const GROUNDED_OPTION_RULES = [
  "- This session HAS project context (the 'Project context' block below). Ground your options in it:",
  "    * groundingRef: a short reference to the bit/topic that supports an option (e.g. the bit's key).",
  "      Set it on options the bits support; leave it null on options the bits do not back.",
  "    * speed: let a relevant bit inform the build-speed tier where it implies scope.",
  "    * recommended: the single best option the bits support is the recommended pick (exactly one per question).",
  "- The bits are authored by the team and are authoritative for what the app IS today — but they describe the",
  "  CURRENT state, NOT a ceiling on the request. Never refuse or omit an option just because a bit doesn't mention",
  "  it when the request is about ADDING or CHANGING that thing.",
  "- SUPPRESS a question (do not ask it) ONLY when a SETTLED bit — kind constraint, tech_stack, or inventory —",
  "  FULLY determines its answer AND the original request is NOT about changing that fact. Example: an 'inventory'",
  "  or 'constraint' bit saying the app is web-only settles a 'which platforms?' question for a styling revamp, so",
  "  skip it; but if the request is 'expand to mobile', platform IS the point — ASK it. NEVER suppress on a",
  "  feature/integration bit; those only ground options. For each suppressed question add an entry to skipped:",
  "  { decisionKey, reason } naming the bit that settled it. Never suppress every question — if all are settled,",
  "  return the single most material one and skip the rest.",
];

/**
 * Render the project bits as a compact, kind-grouped block for the (cached) system
 * prompt. SETTLED kinds are flagged so the model knows which may suppress a
 * question. Coarse by design — key + summary per bit — so the model grounds options
 * without being handed an implementation plan.
 */
function buildBitsBlock(grounding: ProjectGrounding): string {
  const byKind = new Map<BitKind, IProjectBit[]>();
  for (const bit of grounding.bits) {
    const list = byKind.get(bit.kind) ?? [];
    list.push(bit);
    byKind.set(bit.kind, list);
  }

  const lines: string[] = [
    `Project context for "${grounding.projectName}" — authored facts about the app as it is today.`,
    "SETTLED kinds (constraint, tech_stack, inventory) may suppress a question; feature/integration only ground options.",
    "",
  ];
  for (const [kind, bits] of byKind) {
    const settled = SETTLED_BIT_KINDS.includes(kind) ? " [SETTLED]" : "";
    lines.push(`${kind}${settled}:`);
    for (const bit of bits) {
      lines.push(`- (${bit.bit_key}) ${bit.summary}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Build the system prompt as content blocks. The stable rules (+ per-project bits)
 * are the cache prefix: `cache_control` on the LAST block caches the whole system
 * for the session, so batch 2+ reads it from cache (spec R4). Per-call data lives in
 * the user message and is never part of this prefix. Grounded vs ungrounded branch
 * on whether the session has bits.
 */
function buildSystem(grounding?: ProjectGrounding): Anthropic.TextBlockParam[] {
  const rules = [
    ...BASE_RULES,
    ...COMMON_OPTION_RULES,
    ...(grounding ? GROUNDED_OPTION_RULES : UNGROUNDED_OPTION_RULES),
  ].join("\n");

  if (!grounding) {
    return [{ type: "text", text: rules, cache_control: { type: "ephemeral" } }];
  }
  return [
    { type: "text", text: rules },
    { type: "text", text: buildBitsBlock(grounding), cache_control: { type: "ephemeral" } },
  ];
}

function buildUserPrompt(params: GenerateBatchParams): string {
  const priorLines =
    params.priorDecisions.length === 0
      ? "(none yet — this is the first batch)"
      : params.priorDecisions
          .map((d) => `- ${d.key}: ${JSON.stringify(d.value)} [source: ${d.source}]`)
          .join("\n");

  return [
    `Original request:\n${params.originalRequest}`,
    "",
    `Decisions already recorded:\n${priorLines}`,
    "",
    `This is round ${params.roundNumber} of at most ${params.maxRounds}.`,
    `Return at most ${params.maxQuestions} questions in this batch.`,
  ].join("\n");
}

/**
 * Generate one batch via a single structured-output call. The model id is the
 * effective one (primary, or the caller-provided fallback after a rejection).
 * Returns the raw parsed object; the caller re-validates and caps it at the
 * boundary (§11.2) before persisting. Errors propagate to the service, which maps
 * them to a typed InterviewError.
 */
export async function generateBatch(
  params: GenerateBatchParams,
  model: string = INTERVIEW_ENGINE.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: INTERVIEW_ENGINE.MAX_TOKENS,
    // Adaptive thinking + LOW effort: cheap, short generation calls.
    thinking: { type: "adaptive" },
    output_config: {
      effort: INTERVIEW_ENGINE.EFFORT,
      format: zodOutputFormat(generatedBatchOutputSchema),
    },
    // Grounded vs ungrounded rules + the cached bits prefix branch on whether the
    // session has project grounding.
    system: buildSystem(params.grounding),
    messages: [{ role: "user", content: buildUserPrompt(params) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Interview agent returned no parseable batch",
    );
  }
  // Return raw; the service re-validates with the boundary schema (cap included).
  return message.parsed_output;
}
