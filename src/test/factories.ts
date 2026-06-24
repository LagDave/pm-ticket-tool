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

/**
 * A synthetic UNGROUNDED generated batch matching the engine's structured-output
 * shape (the no-findings fallback, spec 6): every option's grounding/effort/
 * recommended is null and `skipped` is null. `hasOpenMaterialDecisions` drives the
 * materiality gate in tests.
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
          { id: "opt_magic", label: "Magic link", groundingRef: null, effort: null, recommended: null },
          { id: "opt_pw", label: "Password", groundingRef: null, effort: null, recommended: null },
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
 * a groundingRef + effort tier, exactly one option is recommended (the easier
 * pick), and `skipped` lists a question a finding already answered. Used to mock
 * the agent so the service's grounded path can be asserted end to end (§20.4).
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
            effort: "S",
            recommended: true,
          },
          {
            id: "opt_new",
            label: "Build a new auth flow",
            groundingRef: "Authentication",
            effort: "L",
            recommended: null,
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
  };
}

/** Local mirror of the generated-ticket shape (no circular import of production types). */
export interface GeneratedTicketShape {
  user_story: string;
  acceptance_criteria: Array<{ given: string; when: string; then: string }>;
  effort: "XS" | "S" | "M" | "L" | "XL";
  context_summary: string;
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

/**
 * A synthetic scout summary matching the scout agent's structured-output shape
 * (spec 5) — what the MODEL returns, before the service/agent stamps the
 * `verifyWithEngineering` flag. Used to mock the agent's model call in tests
 * (§20.4). Coarse, orientation-only areas, never file-level steps.
 */
export function makeScoutSummary(
  overrides: Partial<ScoutSummaryShape> = {},
): ScoutSummaryShape {
  return {
    summary:
      overrides.summary ??
      "The request touches authentication and the user model; both already exist.",
    relevantAreas: overrides.relevantAreas ?? [
      {
        area: "Authentication",
        whatExists: "A session-based login flow already exists.",
        roughSize: "M",
        whatItTouches: ["User model", "Session middleware"],
        feasibility: "likely",
        paths: ["src/auth/login.ts"],
      },
    ],
  };
}

/** The full ScoutFindings (summary + areas + the always-true verify flag). */
export function makeScoutFindings(
  overrides: Partial<ScoutSummaryShape> = {},
): ScoutFindingsShape {
  return { ...makeScoutSummary(overrides), verifyWithEngineering: true };
}

/** Local mirror of one relevant area (no circular import of production types). */
export interface RelevantAreaShape {
  area: string;
  whatExists: string;
  roughSize: "XS" | "S" | "M" | "L" | "XL";
  whatItTouches: string[];
  feasibility: "clear" | "likely" | "uncertain";
  paths: string[];
}

/** Local mirror of the model's scout summary shape. */
export interface ScoutSummaryShape {
  summary: string;
  relevantAreas: RelevantAreaShape[];
}

/** Local mirror of the full findings shape (verify flag stamped). */
export interface ScoutFindingsShape extends ScoutSummaryShape {
  verifyWithEngineering: true;
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
      effort: "XS" | "S" | "M" | "L" | "XL" | null;
      recommended: boolean | null;
    }>;
    allowOther: boolean;
    dependsOn: string[];
  }>;
  hasOpenMaterialDecisions: boolean;
  skipped: Array<{ decisionKey: string; reason: string }> | null;
}
