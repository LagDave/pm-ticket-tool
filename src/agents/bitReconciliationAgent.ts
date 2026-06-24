/**
 * Bit reconciliation agent — the ONLY place the Anthropic SDK is constructed for
 * bit reconciliation (§6.2). Makes one bounded, structured-output call: given the
 * project's existing ACTIVE bits plus a batch of incoming candidate bits, it
 * returns a plan that decides, per candidate, whether to insert / update(merge) /
 * skip_duplicate / conflict / similar. Server-side only — the API key is read
 * through config and never exposed to the frontend (§5.1, §17.3). Mirrors
 * agents/interviewAgent.ts and agents/ticketAgent.ts (the bounded one-call shape:
 * lazy SDK singleton, messages.parse + zodOutputFormat, model default + fallback,
 * system/user prompt builders).
 *
 * The agent PROPOSES; the human DISPOSES (spec R2). It never writes; it returns a
 * plan the service re-validates at the boundary (reconciliationPlanSchema, §11.2)
 * and then surfaces to a human resolve step. `insert` is the only auto-appliable
 * action — every other action carries a target/related bit and a reason so the
 * resolve screen can make the decision cheap to scan. Never auto-delete.
 *
 * Merge is the DEFAULT framing (spec R2): additive coexistence is NOT a conflict.
 * "email/password auth" + "Google auth" describe one richer auth capability, so the
 * agent proposes an `update` that merges them into one bit — it does NOT flag a
 * conflict. `conflict` is reserved for genuinely contradictory facts (e.g. "web
 * only" vs "native mobile app").
 *
 * Cost/latency controls: adaptive thinking at MEDIUM effort, a bounded max_tokens,
 * and a single short-lived call, so no HTTP request runs long under serverless
 * timeouts (spec Risk R5).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The SDK's zodOutputFormat targets the `zod/v4` surface (same constraint the
// interview/ticket agents honor); the boundary re-validation in the service uses
// the plain-`zod` reconciliationPlanSchema. Keep this output schema to the
// structured-output-safe subset (no min/max bounds — the SDK strips them).
import * as zv4 from "zod/v4";
import { BIT_RECONCILIATION, requireAnthropicApiKey } from "../config";
import { logger } from "../config/logger";
import { BIT_KINDS } from "../validation/projectBit";
import { SETTLED_BIT_KINDS } from "../types/project";
import type { BitKind, CandidateBit, IProjectBit } from "../types/project";

/** Lazily-constructed singleton so a missing key fails fast at first use (§5.6). */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  }
  return client;
}

/**
 * Inputs the agent needs to plan a reconciliation. `existingBits` are the
 * project's ACTIVE bits (the service loads them); `candidates` are the incoming
 * batch (an import, a manual add, or a merge-on-complete proposal). Both are
 * loaded/validated by the caller; nothing is queried here.
 */
export interface GenerateReconciliationParams {
  projectName: string;
  existingBits: IProjectBit[];
  candidates: CandidateBit[];
}

/**
 * The reconciliation actions — mirror types/project.ts ReconciliationActionType
 * and the boundary RECONCILIATION_ACTIONS enum. Named once for the output schema.
 */
const RECONCILIATION_ACTIONS = [
  "insert",
  "update",
  "skip_duplicate",
  "conflict",
  "similar",
] as const;

/**
 * The model-facing structured-output schema (zod/v4 for zodOutputFormat). The
 * service re-validates the parsed result with the plain-`zod`
 * reconciliationPlanSchema at the boundary before trusting it (§11.2), so this
 * schema only has to constrain the model's shape — it deliberately stays loose
 * (nullable/optional target ids) and lets the boundary schema be authoritative.
 */
const reconciliationOutputSchema = zv4.object({
  actions: zv4.array(
    zv4.object({
      /** Index into the incoming candidate array this action is for. */
      incomingIndex: zv4.number().int(),
      action: zv4.enum(RECONCILIATION_ACTIONS),
      /** The existing bit this updates/duplicates/conflicts with (null when none). */
      targetBitId: zv4.number().int().nullable(),
      /** For `similar`: other related existing bit ids ([] when none). */
      relatedBitIds: zv4.array(zv4.number().int()),
      /** For `update`: the merged summary the agent proposes (null otherwise). */
      mergedSummary: zv4.string().nullable(),
      /** Short auditable reason for the action. */
      reason: zv4.string(),
    }),
  ),
});

/**
 * System prompt — merge-DEFAULT reconciliation rules baked in (spec R2). Static
 * across calls (the per-call bits + candidates go in the user message), mirroring
 * how the ticket agent keeps its rules in a constant. The settled kinds are named
 * from the shared SETTLED_BIT_KINDS constant so the agent, the engine, and tests
 * share one source of truth (§4.2).
 */
const SYSTEM_PROMPT = [
  "You are a project-context curator. A project owns a set of typed 'bits' — short",
  "key->summary facts about an application (its features, constraints, integrations,",
  "tech stack, and inventory). A batch of CANDIDATE bits has just been proposed (from",
  "a bulk import, a manual add, or a finished ticket). Your job is to reconcile each",
  "candidate against (a) the project's existing ACTIVE bits AND (b) the OTHER",
  "candidates in the same batch, and return a plan of actions.",
  "",
  "You PROPOSE; a human DISPOSES. Never assume an action is applied. Only `insert` is",
  "auto-applied; every other action is reviewed by a person, so give each a clear,",
  "auditable reason. Never delete anything — superseding on merge is the system's job,",
  "not yours.",
  "",
  "For each candidate, choose exactly one action:",
  "- insert: a genuinely new fact not already present and not contradicting anything.",
  "- update: this candidate enriches or refines an existing bit (or another candidate)",
  "    that covers the SAME topic. Propose a single richer `mergedSummary` that folds",
  "    both facts together, and set targetBitId to the existing bit it merges into",
  "    (when the overlap is with an existing bit, not just another candidate).",
  "- skip_duplicate: the fact is already present (an existing active bit, or an",
  "    earlier candidate in this batch, already says it). Set targetBitId when it",
  "    duplicates an existing bit.",
  "- conflict: the candidate genuinely CONTRADICTS an existing bit (both cannot be",
  "    true at once). Set targetBitId to the bit it contradicts.",
  "- similar: adjacent but DISTINCT — related to one or more existing bits without",
  "    duplicating, enriching, or contradicting them. List those in relatedBitIds.",
  "",
  "MERGE IS THE DEFAULT. Additive coexistence is NOT a conflict. Example: an existing",
  "bit 'auth: email/password' and a candidate 'auth: Google sign-in' describe ONE",
  "richer authentication capability — propose `update` with a merged summary like",
  "'auth: email/password and Google sign-in', NOT a conflict. Reserve `conflict` for",
  "facts that cannot both hold (e.g. 'platform: web only' vs 'platform: native iOS",
  "and Android app'). When unsure between conflict and update, prefer update and say",
  "why in the reason — a human will confirm.",
  "",
  "Match by MEANING, not by the cosmetic bit_key: two bits about the same thing under",
  "different keys are still the same topic. Settled-kind bits (constraint, tech_stack,",
  `inventory — here: ${SETTLED_BIT_KINDS.join(", ")}) describe hard facts; weigh a`,
  "candidate that touches one of those carefully, but the same merge-default rules",
  "apply.",
  "",
  "incomingIndex MUST be the 0-based position of the candidate in the incoming list.",
  "targetBitId/relatedBitIds MUST reference an id from the existing-bits list (never a",
  "candidate index); use null / [] when no existing bit applies. mergedSummary is set",
  "only for `update` (null otherwise). Never use em-dashes or en-dashes; use commas,",
  "periods, parentheses, or hyphens.",
].join("\n");

/**
 * Render the project's existing ACTIVE bits as a compact, id-tagged, kind-grouped
 * block. The id is shown explicitly because the model must reference it in
 * targetBitId/relatedBitIds. Coarse by design — id + key + summary per bit.
 */
function buildExistingBlock(bits: IProjectBit[]): string {
  if (bits.length === 0) {
    return "Existing active bits: (none — this project has no bits yet).";
  }
  const byKind = new Map<BitKind, IProjectBit[]>();
  for (const bit of bits) {
    const list = byKind.get(bit.kind) ?? [];
    list.push(bit);
    byKind.set(bit.kind, list);
  }

  const lines: string[] = ["Existing active bits (reference these ids in targetBitId/relatedBitIds):"];
  for (const [kind, kindBits] of byKind) {
    lines.push(`${kind}:`);
    for (const bit of kindBits) {
      lines.push(`- [id ${bit.id}] (${bit.bit_key}) ${bit.summary}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render the incoming candidates as a 0-indexed list. The index is the value the
 * model must echo back in incomingIndex, so it is shown explicitly.
 */
function buildCandidatesBlock(candidates: CandidateBit[]): string {
  const lines: string[] = ["Incoming candidate bits (reconcile each by its index):"];
  candidates.forEach((candidate, index) => {
    lines.push(`- [index ${index}] kind=${candidate.kind} (${candidate.bit_key}) ${candidate.summary}`);
  });
  return lines.join("\n");
}

function buildUserPrompt(params: GenerateReconciliationParams): string {
  return [
    `Project: ${params.projectName}`,
    "",
    buildExistingBlock(params.existingBits),
    "",
    buildCandidatesBlock(params.candidates),
    "",
    "Return one action per candidate, in incomingIndex order, as structured output.",
  ].join("\n");
}

/**
 * Generate a reconciliation plan via a single structured-output call. The model id
 * is the effective one (primary, or the caller-provided fallback after a
 * rejection). Returns the RAW parsed object; the caller (BitReconciliationService)
 * re-validates it against reconciliationPlanSchema at the boundary (§11.2) before
 * trusting or applying any action. Errors propagate to the service, which maps
 * them to a typed ProjectError and retries with the fallback model once.
 */
export async function generateReconciliationPlan(
  params: GenerateReconciliationParams,
  model: string = BIT_RECONCILIATION.MODEL,
): Promise<unknown> {
  const message = await getClient().messages.parse({
    model,
    max_tokens: BIT_RECONCILIATION.MAX_TOKENS,
    // Adaptive thinking + MEDIUM effort: bounded dedup/merge synthesis call (spec T8).
    thinking: { type: "adaptive" },
    output_config: {
      effort: BIT_RECONCILIATION.EFFORT,
      format: zodOutputFormat(reconciliationOutputSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(params) }],
  });

  if (message.parsed_output === null) {
    logger.warn(
      { stopReason: message.stop_reason, model },
      "Bit reconciliation agent returned no parseable plan",
    );
  }
  // Return raw; the service re-validates with the boundary schema (§11.2).
  return message.parsed_output;
}

// Re-export the kinds the agent constrains against so a future caller can assert
// candidate kinds without re-importing the validation module directly. Keeps the
// agent's contract self-describing (BIT_KINDS is the single source, §4.2).
export { BIT_KINDS };
