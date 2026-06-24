/**
 * Test factories — build synthetic data only (§20.4). Each factory produces a
 * unique owner so owner-scope tests stay isolated.
 */
import type { OwnerContext } from "../types/interview";

let ownerSeq = 1000;

/** A distinct synthetic owner per call. */
export function makeOwner(overrides: Partial<OwnerContext> = {}): OwnerContext {
  ownerSeq += 1;
  return {
    ownerUserId: overrides.ownerUserId ?? ownerSeq,
    organizationId: overrides.organizationId ?? null,
  };
}

/** A synthetic initial-request string. */
export function makeRequestText(suffix = ""): string {
  return `Add a feature that does the thing${suffix ? ` (${suffix})` : ""}.`;
}

/** A synthetic project name. */
export function makeProjectName(suffix = ""): string {
  return `Project ${suffix || "Alpha"}`;
}

/**
 * A synthetic candidate-bit body (the create/import row shape). Defaults to a
 * `feature` kind; pass overrides to exercise settled kinds. Used to seed manual
 * bit creates in service/model tests (§20.4).
 */
export function makeCandidateBit(
  overrides: Partial<CandidateBitShape> = {},
): CandidateBitShape {
  return {
    kind: overrides.kind ?? "feature",
    bit_key: overrides.bit_key ?? "auth",
    summary: overrides.summary ?? "Email/password plus Google sign-in.",
  };
}

/** Local mirror of the candidate-bit body shape (no circular import of production types). */
export interface CandidateBitShape {
  kind: "feature" | "constraint" | "integration" | "tech_stack" | "inventory";
  bit_key: string;
  summary: string;
}

/**
 * A synthetic UNGROUNDED generated batch matching the engine's structured-output
 * shape (the no-findings fallback, spec 6): no groundingRef and `skipped` is null,
 * but every option still carries a `speed` tier and exactly one option is
 * `recommended`. `hasOpenMaterialDecisions` drives the materiality gate in tests.
 */
export function makeBatch(
  overrides: Partial<{
    questions: GeneratedBatchShape["questions"];
    hasOpenMaterialDecisions: boolean;
    skipped: GeneratedBatchShape["skipped"];
  }> = {},
): GeneratedBatchShape {
  return {
    questions: overrides.questions ?? [
      {
        id: "q1",
        decisionKey: "auth_method",
        text: "How should users authenticate?",
        options: [
          { id: "opt_magic", label: "Magic link", groundingRef: null, speed: "fast", recommended: true },
          { id: "opt_pw", label: "Password", groundingRef: null, speed: "moderate", recommended: false },
        ],
        allowOther: true,
        dependsOn: [],
      },
    ],
    hasOpenMaterialDecisions: overrides.hasOpenMaterialDecisions ?? false,
    skipped: overrides.skipped ?? null,
  };
}

/**
 * A synthetic GROUNDED generated batch (spec 6 — findings present): options carry
 * a groundingRef + a build-speed tier, exactly one option is recommended (the
 * single best pick), and `skipped` lists a question a finding already answered.
 * Used to mock the agent so the service's grounded path can be asserted (§20.4).
 */
export function makeGroundedBatch(
  overrides: Partial<{
    questions: GeneratedBatchShape["questions"];
    hasOpenMaterialDecisions: boolean;
    skipped: GeneratedBatchShape["skipped"];
  }> = {},
): GeneratedBatchShape {
  return {
    questions: overrides.questions ?? [
      {
        id: "q1",
        decisionKey: "auth_method",
        text: "How should users authenticate?",
        options: [
          {
            id: "opt_reuse",
            label: "Reuse the existing auth provider (verify with engineering)",
            groundingRef: "Authentication",
            speed: "fast",
            recommended: true,
          },
          {
            id: "opt_new",
            label: "Build a new auth flow",
            groundingRef: "Authentication",
            speed: "slow",
            recommended: false,
          },
        ],
        allowOther: true,
        dependsOn: [],
      },
    ],
    hasOpenMaterialDecisions: overrides.hasOpenMaterialDecisions ?? false,
    skipped:
      overrides.skipped ?? [
        { decisionKey: "data_store", reason: "Findings show Postgres is already the data store." },
      ],
  };
}

/**
 * A synthetic generated TICKET matching the ticket agent's structured-output
 * shape (spec 3). Story in the As a / I want / So that form, two Given/When/Then
 * criteria, and a tier effort (never hours). Used to mock the agent in tests.
 */
export function makeGeneratedTicket(
  overrides: Partial<GeneratedTicketShape> = {},
): GeneratedTicketShape {
  return {
    user_story:
      overrides.user_story ??
      "As a PM, I want to generate a ticket, So that I can hand it off.",
    acceptance_criteria: overrides.acceptance_criteria ?? [
      {
        given: "a completed interview session",
        when: "the PM generates a ticket",
        then: "a draft ticket persists in the standard format",
      },
      {
        given: "a malformed model response",
        when: "the generator validates it",
        then: "no ticket is written and an error is raised",
      },
    ],
    effort: overrides.effort ?? "M",
    context_summary:
      overrides.context_summary ?? "Generate a durable ticket from saved decisions.",
    priority: overrides.priority ?? "medium",
    problem_background:
      overrides.problem_background ??
      "PMs lose interview detail when a ticket only shows four fields.",
    key_decisions: overrides.key_decisions ?? [
      { label: "Authenticate via magic link", detail: "Chosen over passwords for speed." },
      { label: "Links expire in 15 minutes", detail: "" },
    ],
    open_questions: overrides.open_questions ?? ["Should magic links be single-use?"],
    success_metrics:
      overrides.success_metrics ?? ["PMs hand off tickets without follow-up questions."],
    dependencies: overrides.dependencies ?? ["Transactional email provider"],
    codebase_grounding: overrides.codebase_grounding ?? [
      { area: "Authentication", note: "A session-based login flow already exists." },
    ],
  };
}

/** Local mirror of the generated-ticket shape (no circular import of production types). */
export interface GeneratedTicketShape {
  user_story: string;
  acceptance_criteria: Array<{ given: string; when: string; then: string }>;
  effort: "XS" | "S" | "M" | "L" | "XL";
  context_summary: string;
  priority: "high" | "medium" | "low";
  problem_background: string;
  key_decisions: Array<{ label: string; detail: string }>;
  open_questions: string[];
  success_metrics: string[];
  dependencies: string[];
  codebase_grounding: Array<{ area: string; note: string }>;
}

/**
 * A synthetic triage classification matching the triage agent's structured-output
 * shape (spec 7). Defaults to `scoped` (the safe default); pass an override to
 * exercise the `simple` path. Used to mock the agent in tests (§20.4).
 */
export function makeTriageClassification(
  overrides: Partial<TriageClassificationShape> = {},
): TriageClassificationShape {
  return {
    result: overrides.result ?? "scoped",
    reason: overrides.reason ?? "Synthetic triage classification for tests.",
  };
}

/** Local mirror of the triage classification shape (no circular import of production types). */
export interface TriageClassificationShape {
  result: "simple" | "scoped";
  reason: string;
}

/** Local mirror of the batch shape so factories don't import production types circularly. */
export interface GeneratedBatchShape {
  questions: Array<{
    id: string;
    decisionKey: string;
    text: string;
    options: Array<{
      id: string;
      label: string;
      groundingRef: string | null;
      speed: "slowest" | "slow" | "moderate" | "fast" | "fastest";
      recommended: boolean;
    }>;
    allowOther: boolean;
    dependsOn: string[];
  }>;
  hasOpenMaterialDecisions: boolean;
  skipped: Array<{ decisionKey: string; reason: string }> | null;
}
