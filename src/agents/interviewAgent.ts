/**
 * Interview agent — the ONLY place the Anthropic SDK is constructed (§6.2).
 * Makes one bounded, structured-output call per batch: given the original
 * request plus prior decisions, it returns up to four dependency-ordered
 * questions as validated JSON (spec T2). Server-side only — the API key is read
 * through config and never exposed to the frontend (§5.1, §17.3).
 *
 * Cost/latency controls (spec Constraints, Risk): adaptive thinking at LOW
 * effort, a bounded max_tokens, and a single short-lived call per turn (not a
 * long agent loop), so no HTTP request runs long under serverless timeouts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { INTERVIEW_ENGINE, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { generatedBatchOutputSchema } from "../validation/interviewQuestions";
import type { ScoutFindings } from "../types/codeScout";
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
   * Cached scout findings for the session (spec 6). When present, options are
   * GROUNDED in these findings (groundingRef + effort + an optional recommended
   * pick) and questions a finding already answers are skipped. Absent (undefined)
   * on the no-findings fallback — generation then produces ungrounded options
   * exactly as before. Read from scout_cache by the service; never queried here.
   */
  findings?: ScoutFindings;
}

/**
 * Base interviewer rules — shared by the grounded and ungrounded paths so the
 * no-findings path is unchanged from before grounding existed (spec Pushback:
 * the fallback is explicit, not incidental). Option-shape rules differ by path
 * and are appended below.
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
 * Ungrounded option rules (no findings): grounding/effort/recommended are not
 * filled, and nothing is skipped. Byte-for-byte the behavior before spec 6.
 */
const UNGROUNDED_OPTION_RULES = [
  "- This session has no codebase findings. Leave every option's groundingRef, effort,",
  "  and recommended null. Return skipped as null — there are no findings to skip against.",
];

/**
 * Grounded option rules (findings present): every option derives from a finding,
 * carries an effort tier and an optional recommended pick, and questions a finding
 * already determines are skipped with a reason. The "verify with engineering"
 * framing is mandatory — findings orient, they never certify (spec Risk, §3.4).
 */
const GROUNDED_OPTION_RULES = [
  "- This session HAS codebase findings (below). Ground your options in them:",
  "    * groundingRef: a short reference to the finding/area that supports this option",
  "      (e.g. the area name). Set it on options the findings support; leave it null on",
  "      options the findings do not back.",
  "    * effort: a COARSE tier — one of XS, S, M, L, XL — informed by the relevant area's",
  "      roughSize. Never hours. Null only when no finding informs the option.",
  "    * recommended: set true on AT MOST ONE option per question — the easier, lower-effort",
  "      path the findings support (the 'here's the easier way' pick). Leave null otherwise.",
  "- Findings are ORIENTATION, to be verified with engineering — never a guarantee. Phrase",
  "  grounded option labels as advisory (e.g. 'likely reuses ...; verify with engineering'),",
  "  not as certainty.",
  "- SKIP a question only when a finding FULLY determines its answer (the area's feasibility",
  "  is 'clear'). Do not skip on a partial hint ('likely'/'uncertain') — still ask those.",
  "  For each skipped question, add an entry to skipped: { decisionKey, reason } where reason",
  "  names the finding that answered it. Never skip every question — if all are determined,",
  "  return the most material one and skip the rest.",
];

function buildSystemPrompt(hasFindings: boolean): string {
  const optionRules = hasFindings
    ? GROUNDED_OPTION_RULES
    : UNGROUNDED_OPTION_RULES;
  return [...BASE_RULES, ...optionRules].join("\n");
}

/**
 * Render the cached findings as a compact, orientation-only block for the prompt
 * (spec 6). Coarse by design — area, what exists, rough size, feasibility — so the
 * model grounds options without being handed an implementation plan (§3.4).
 */
function buildFindingsBlock(findings: ScoutFindings): string {
  const areaLines = findings.relevantAreas
    .map(
      (area) =>
        `- ${area.area} (roughSize ${area.roughSize}, feasibility ${area.feasibility}): ` +
        `${area.whatExists} Touches: ${area.whatItTouches.join(", ") || "n/a"}.`,
    )
    .join("\n");

  return [
    "Codebase findings (orientation only — verify with engineering):",
    findings.summary,
    "",
    "Relevant areas:",
    areaLines || "(none surfaced)",
  ].join("\n");
}

function buildUserPrompt(params: GenerateBatchParams): string {
  const priorLines =
    params.priorDecisions.length === 0
      ? "(none yet — this is the first batch)"
      : params.priorDecisions
          .map((d) => `- ${d.key}: ${JSON.stringify(d.value)} [source: ${d.source}]`)
          .join("\n");

  const lines = [
    `Original request:\n${params.originalRequest}`,
    "",
    `Decisions already recorded:\n${priorLines}`,
  ];

  // Grounded path only — append the findings block (spec 6). The ungrounded path
  // omits it entirely, so its prompt is unchanged from before grounding existed.
  if (params.findings) {
    lines.push("", buildFindingsBlock(params.findings));
  }

  lines.push(
    "",
    `This is round ${params.roundNumber} of at most ${params.maxRounds}.`,
    `Return at most ${params.maxQuestions} questions in this batch.`,
  );

  return lines.join("\n");
}

/**
 * Generate one batch via a single structured-output call. The model id is the
 * effective one (primary, or the caller-provided fallback after a rejection).
 * Returns the raw parsed object; the caller re-validates and caps it at the
 * boundary (§11.2) before persisting. Errors propagate to the service, which
 * maps them to a typed InterviewError.
 */
export async function generateBatch(
  params: GenerateBatchParams,
  model: string = INTERVIEW_ENGINE.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: INTERVIEW_ENGINE.MAX_TOKENS,
    // Adaptive thinking + LOW effort: cheap, short generation calls (spec Constraints).
    thinking: { type: "adaptive" },
    output_config: {
      effort: INTERVIEW_ENGINE.EFFORT,
      format: zodOutputFormat(generatedBatchOutputSchema),
    },
    // Grounded vs ungrounded option rules branch on whether findings are present (spec 6).
    system: buildSystemPrompt(params.findings !== undefined),
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
